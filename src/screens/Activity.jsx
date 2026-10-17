import { useMemo, useState } from "react";
import Sheet from "../components/Sheet";
import { CATEGORY_KEYS, categoryName, dateLabel, money, monthLabel } from "../lib/format";
import { monthKey, txCategory } from "../lib/finance";

const PAGE = 150;

export default function Activity({ ledger, initialFilter }) {
  const { transactions, accounts, updateTransaction } = ledger;
  const [query, setQuery] = useState(initialFilter?.query ?? "");
  const [accountId, setAccountId] = useState("");
  const [category, setCategory] = useState(initialFilter?.category ?? "");
  const [month, setMonth] = useState(initialFilter?.month ?? "");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState(null);

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.nickname || a.name])), [accounts]);
  const months = useMemo(() => [...new Set(transactions.map((t) => monthKey(t.date)))], [transactions]);
  const categories = useMemo(() => [...new Set([...CATEGORY_KEYS, ...transactions.map(txCategory)])], [transactions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) =>
      (!accountId || t.account_id === accountId) &&
      (!category || txCategory(t) === category) &&
      (!month || monthKey(t.date) === month) &&
      (!q || `${t.merchant_name ?? ""} ${t.name} ${t.notes ?? ""}`.toLowerCase().includes(q)),
    );
  }, [transactions, query, accountId, category, month]);

  const groups = useMemo(() => {
    const out = [];
    for (const t of filtered.slice(0, limit)) {
      if (out.at(-1)?.date !== t.date) out.push({ date: t.date, items: [] });
      out.at(-1).items.push(t);
    }
    return out;
  }, [filtered, limit]);

  const hasFilters = query || accountId || category || month;

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Activity</h1>
      </header>

      <div className="filters">
        <input className="search" type="search" placeholder="Search merchants and notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search transactions" />
        <div className="filter-row">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}{a.mask ? ` ••${a.mask}` : ""}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{categoryName(c)}</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        {hasFilters && (
          <button className="btn-text" onClick={() => { setQuery(""); setAccountId(""); setCategory(""); setMonth(""); }}>
            Clear filters ({filtered.length} shown)
          </button>
        )}
      </div>

      {!groups.length && <p className="meta empty-inline">{transactions.length ? "No transactions match these filters." : "No transactions yet. They appear after your first sync."}</p>}

      {groups.map((g) => (
        <section key={g.date} className="day">
          <h2 className="day-head">{dateLabel(g.date)}</h2>
          <ul className="tx-list">
            {g.items.map((t) => (
              <li key={t.id}>
                <button className={`tx tx-btn ${t.is_excluded ? "excluded" : ""}`} onClick={() => setEditing(t)}>
                  <div className="tx-main">
                    <span className="tx-name">{t.merchant_name || t.name}</span>
                    <span className="tx-sub">
                      {categoryName(txCategory(t))} · {accountName.get(t.account_id)}{t.pending ? " · Pending" : ""}
                    </span>
                    {t.notes && <span className="tx-note">{t.notes}</span>}
                  </div>
                  <span className={`tx-amt ${t.amount < 0 ? "pos" : ""}`}>{t.amount < 0 ? "+" : ""}{money(Math.abs(t.amount))}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {filtered.length > limit && (
        <button className="btn-quiet wide" onClick={() => setLimit((l) => l + PAGE)}>Show more</button>
      )}

      {editing && (
        <EditTransaction
          tx={editing}
          accountName={accountName.get(editing.account_id)}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={async (patch) => { await updateTransaction(editing.id, patch); setEditing(null); }}
        />
      )}
    </>
  );
}

function EditTransaction({ tx, accountName, categories, onClose, onSave }) {
  const [cat, setCat] = useState(tx.user_category ?? "");
  const [notes, setNotes] = useState(tx.notes ?? "");
  const [excluded, setExcluded] = useState(tx.is_excluded);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    try {
      await onSave({ user_category: cat || null, notes: notes.trim() || null, is_excluded: excluded });
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <Sheet title={tx.merchant_name || tx.name} onClose={onClose}>
      <p className={`sheet-figure ${tx.amount < 0 ? "pos" : ""}`}>{tx.amount < 0 ? "+" : ""}{money(Math.abs(tx.amount))}</p>
      <dl className="detail-list">
        <div><dt>Date</dt><dd>{dateLabel(tx.date)}</dd></div>
        <div><dt>Account</dt><dd>{accountName}</dd></div>
        <div><dt>Bank description</dt><dd>{tx.name}</dd></div>
        {tx.pending && <div><dt>Status</dt><dd>Pending</dd></div>}
      </dl>
      <label className="field">
        Category
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{categoryName(tx.category_primary)} (from your bank)</option>
          {categories.filter((c) => c !== tx.category_primary).map((c) => <option key={c} value={c}>{categoryName(c)}</option>)}
        </select>
      </label>
      <label className="field">
        Note
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note" />
      </label>
      <label className="toggle">
        <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
        <span>Leave out of spending totals</span>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
    </Sheet>
  );
}
