import { useState } from "react";
import Sheet from "../components/Sheet";
import { money, moneyWhole, timeAgo } from "../lib/format";
import { supabase } from "../lib/supabase";

const GROUPS = [
  { type: "depository", title: "Cash" },
  { type: "credit", title: "Credit cards" },
  { type: "loan", title: "Loans" },
  { type: "investment", title: "Investments" },
];

export default function Accounts({ ledger, plaid }) {
  const { accounts, items, updateAccount, sync, syncing } = ledger;
  const [editing, setEditing] = useState(null);
  const known = GROUPS.map((g) => g.type);
  const groups = [...GROUPS, { type: "other", title: "Other" }]
    .map((g) => ({ ...g, list: accounts.filter((a) => (g.type === "other" ? !known.includes(a.type) : a.type === g.type)) }))
    .filter((g) => g.list.length);

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Accounts</h1>
        <button className="btn-primary sm" onClick={() => plaid.start()} disabled={plaid.busy}>{plaid.busy ? "Opening…" : "Link account"}</button>
      </header>

      {!accounts.length && <p className="meta empty-inline">No accounts linked yet. Link your bank to bring in balances and transactions.</p>}

      {groups.map((g) => {
        const visible = g.list.filter((a) => !a.is_hidden);
        const total = visible.reduce((s, a) => s + Number(a.current_balance ?? 0), 0);
        return (
          <section key={g.type} className="block">
            <div className="block-head static"><h2>{g.title}</h2><span className="figure-sm">{money(total)}</span></div>
            <ul className="acct-list">
              {g.list.map((a) => (
                <li key={a.id}>
                  <button className={`acct ${a.is_hidden ? "hidden" : ""}`} onClick={() => setEditing(a)}>
                    <div className="tx-main">
                      <span className="tx-name">{a.nickname || a.name}</span>
                      <span className="tx-sub">
                        {items.find((i) => i.id === a.item_id)?.institution_name ?? ""}{a.mask ? ` ••${a.mask}` : ""}{a.is_hidden ? " · Hidden" : ""}
                      </span>
                    </div>
                    <div className="acct-right">
                      <span className="num">{money(a.current_balance)}</span>
                      {a.type === "credit" && a.credit_limit && (
                        <span className="tx-sub">{moneyWhole(a.credit_limit - (a.current_balance ?? 0))} available</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {items.length > 0 && (
        <section className="block">
          <div className="block-head static">
            <h2>Connected banks</h2>
            <button className="btn-text" onClick={() => sync()} disabled={syncing}>{syncing ? "Refreshing…" : "Refresh all"}</button>
          </div>
          <ul className="plain-list">
            {items.map((i) => (
              <li key={i.id}>
                <span>
                  {i.institution_name ?? "Bank"}
                  <span className={`tx-sub ${i.status !== "active" ? "neg" : ""}`}>
                    {" "}{i.status === "active" ? `Updated ${timeAgo(i.last_synced_at)}` : i.status === "login_required" ? "Sign-in needed" : "Last update failed"}
                  </span>
                </span>
                {i.status !== "active" && <button className="btn-quiet" onClick={() => plaid.start(i.id)} disabled={plaid.busy}>Sign in</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="block signout">
        <button className="btn-text" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>

      {editing && (
        <EditAccount
          account={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await updateAccount(editing.id, patch); setEditing(null); }}
        />
      )}
    </>
  );
}

function EditAccount({ account, onClose, onSave }) {
  const [nickname, setNickname] = useState(account.nickname ?? "");
  const [hidden, setHidden] = useState(account.is_hidden);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    try {
      await onSave({ nickname: nickname.trim() || null, is_hidden: hidden });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <Sheet title={account.nickname || account.name} onClose={onClose}>
      <p className="sheet-figure">{money(account.current_balance)}</p>
      <dl className="detail-list">
        <div><dt>Bank name</dt><dd>{account.official_name || account.name}</dd></div>
        {account.available_balance != null && <div><dt>Available</dt><dd>{money(account.available_balance)}</dd></div>}
        {account.credit_limit != null && <div><dt>Credit limit</dt><dd>{money(account.credit_limit)}</dd></div>}
        <div><dt>Type</dt><dd className="cap">{account.subtype || account.type}</dd></div>
      </dl>
      <label className="field">
        Nickname
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={account.name} />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
        <span>Hide from net worth and totals</span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
    </Sheet>
  );
}
