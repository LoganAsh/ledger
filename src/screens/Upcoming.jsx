import { useMemo, useState } from "react";
import Sheet from "../components/Sheet";
import { categoryName, dateLabel, money, moneyWhole, monthLabel } from "../lib/format";
import { shiftMonth } from "../lib/finance";
import { FREQUENCIES, addDays, buildSchedule, frequencyLabel, fromIso, todayIso } from "../lib/upcoming";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const SOURCE_LABEL = { bill: "Bill", recurring: "Estimated", card: "Card due" };

export default function Upcoming({ ledger, plaid, go }) {
  const { accounts, items, hiddenRecurring, unhideRecurring } = ledger;
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(null); // { type: 'bill'|'recurring'|'card', entry } or { type:'new', prefill }
  const [showHidden, setShowHidden] = useState(false);

  const monthStart = `${month}-01`;
  const monthEnd = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const horizon = addDays(today, 30);

  const schedule = useMemo(
    () => buildSchedule(ledger, monthStart < today ? monthStart : today, monthEnd > horizon ? monthEnd : horizon),
    [ledger, monthStart, monthEnd, today, horizon],
  );
  const byDate = useMemo(() => {
    const m = new Map();
    for (const e of schedule) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date).push(e); }
    return m;
  }, [schedule]);

  const next30 = schedule.filter((e) => e.date >= today && e.date <= horizon && !e.paid);
  const due30 = next30.reduce((s, e) => s + e.amount, 0);
  const cash = accounts.filter((a) => a.type === "depository" && !a.is_hidden).reduce((s, a) => s + Number(a.available_balance ?? a.current_balance ?? 0), 0);
  const consentItems = items.filter((i) => i.liabilities_status === "consent_required");

  // Calendar grid
  const first = fromIso(monthStart);
  const lead = first.getDay();
  const days = fromIso(monthEnd).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];

  const listDate = selected;
  const list = listDate ? byDate.get(listDate) ?? [] : next30;

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Upcoming</h1>
        <button className="btn-primary sm" onClick={() => setOpen({ type: "new" })}>Add bill</button>
      </header>

      <section className="cover">
        <div>
          <p className="strip-label">Due in the next 30 days</p>
          <p className="figure-lg">{money(due30)}</p>
        </div>
        <dl className="cover-rows">
          <div><dt>Cash in checking & savings</dt><dd>{money(cash)}</dd></div>
          <div><dt>Left after payments</dt><dd className={cash - due30 < 0 ? "neg" : ""}>{money(cash - due30)}</dd></div>
        </dl>
      </section>

      {consentItems.map((i) => (
        <div key={i.id} className="attention">
          <span>Allow {i.institution_name ?? "this bank"} to share card due dates and statement balances.</span>
          <button className="btn-quiet" onClick={() => plaid.start(i.id, { consent: true })} disabled={plaid.busy}>Allow</button>
        </div>
      ))}

      <section className="calendar" aria-label={`Payments in ${monthLabel(month)}`}>
        <div className="month-nav">
          <button className="btn-quiet" onClick={() => { setMonth(shiftMonth(month, -1)); setSelected(null); }} aria-label="Previous month">‹</button>
          <span>{monthLabel(month)}</span>
          <button className="btn-quiet" onClick={() => { setMonth(shiftMonth(month, 1)); setSelected(null); }} aria-label="Next month">›</button>
        </div>
        <div className="cal-grid" role="grid">
          {WEEKDAYS.map((d, i) => <span key={i} className="cal-wd" aria-hidden="true">{d}</span>)}
          {cells.map((iso, i) => {
            if (!iso) return <span key={`x${i}`} />;
            const entries = byDate.get(iso) ?? [];
            const total = entries.filter((e) => !e.paid).reduce((s, e) => s + e.amount, 0);
            const cls = ["cal-day", iso === today && "today", iso < today && "past", iso === selected && "selected", entries.length && "has"].filter(Boolean).join(" ");
            return (
              <button
                key={iso}
                className={cls}
                onClick={() => setSelected(iso === selected ? null : iso)}
                aria-label={`${dateLabel(iso)}${entries.length ? `, ${entries.length} payment${entries.length > 1 ? "s" : ""}, ${money(total)}` : ""}`}
                aria-pressed={iso === selected}
              >
                <span className="cal-num">{Number(iso.slice(8))}</span>
                {entries.length > 0 && <span className="cal-amt">{total >= 1000 ? `${(total / 1000).toFixed(1)}k` : Math.round(total)}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="block">
        <div className="block-head static">
          <h2>{listDate ? dateLabel(listDate) : "Next 30 days"}</h2>
          {listDate && <button className="btn-text" onClick={() => setSelected(null)}>Show next 30 days</button>}
        </div>
        {!list.length && (
          <p className="meta">
            {listDate ? "Nothing due this day." : "Nothing expected in the next 30 days. Add a bill, or check back once more transaction history has synced."}
          </p>
        )}
        <ul className="tx-list">
          {list.map((e, idx) => {
            const showDate = !listDate && (idx === 0 || list[idx - 1].date !== e.date);
            return (
              <li key={e.key}>
                {showDate && <p className="due-date">{dateLabel(e.date)}</p>}
                <button className={`tx tx-btn ${e.paid ? "excluded" : ""}`} onClick={() => setOpen({ type: e.source, entry: e })}>
                  <div className="tx-main">
                    <span className="tx-name">{e.name}</span>
                    <span className="tx-sub">
                      <span className={`tag tag-${e.source}`}>{SOURCE_LABEL[e.source]}</span>
                      {e.paid ? " Paid" : e.overdue ? " Overdue" : ""}
                      {e.autopay ? " Autopay" : ""}
                      {e.account ? ` ${e.account}` : ""}
                    </span>
                  </div>
                  <span className={`tx-amt ${e.overdue ? "neg" : ""}`}>{e.estimated ? "≈" : ""}{money(e.amount)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {hiddenRecurring.length > 0 && (
        <section className="block">
          <button className="btn-text" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? "Hide list" : `Hidden estimates (${hiddenRecurring.length})`}
          </button>
          {showHidden && (
            <ul className="plain-list">
              {hiddenRecurring.map((h) => (
                <li key={h.id}>
                  <span>{h.merchant}</span>
                  <button className="btn-quiet" onClick={() => unhideRecurring(h.id)}>Show again</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {open?.type === "new" && <BillSheet ledger={ledger} prefill={open.prefill} onClose={() => setOpen(null)} />}
      {open?.type === "bill" && <BillSheet ledger={ledger} bill={open.entry.bill} onClose={() => setOpen(null)} />}
      {open?.type === "recurring" && (
        <RecurringSheet
          entry={open.entry}
          ledger={ledger}
          onClose={() => setOpen(null)}
          onConvert={(prefill) => setOpen({ type: "new", prefill })}
          go={go}
        />
      )}
      {open?.type === "card" && <CardSheet entry={open.entry} onClose={() => setOpen(null)} />}
    </>
  );
}

function BillSheet({ ledger, bill, prefill, onClose }) {
  const { accounts, saveBill, deleteBill, hideRecurring } = ledger;
  const init = bill ?? prefill ?? {};
  const [name, setName] = useState(init.name ?? "");
  const [amount, setAmount] = useState(init.amount != null ? String(init.amount) : "");
  const [frequency, setFrequency] = useState(init.frequency ?? "monthly");
  const [nextDue, setNextDue] = useState(init.next_due ?? todayIso());
  const [accountId, setAccountId] = useState(init.account_id ?? "");
  const [autopay, setAutopay] = useState(init.autopay ?? false);
  const [notes, setNotes] = useState(init.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    const n = Number(amount.replace(/[$,]/g, ""));
    if (!name.trim()) return setError("Give the bill a name.");
    if (!Number.isFinite(n) || n < 0) return setError("Enter a valid amount.");
    setBusy(true);
    setError(null);
    try {
      await saveBill({
        ...(bill ? { id: bill.id } : {}),
        name: name.trim(), amount: n, frequency, next_due: nextDue,
        account_id: accountId || null, autopay, notes: notes.trim() || null,
      });
      // Replacing an estimate: hide the auto-detected version so it isn't counted twice
      if (prefill?.fromRecurring) await hideRecurring(prefill.fromRecurring);
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${bill.name}?`)) return;
    setBusy(true);
    try { await deleteBill(bill.id); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Sheet title={bill ? "Edit bill" : "Add bill"} onClose={onClose}>
      <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent, truck payment, insurance…" /></label>
      <div className="field-row">
        <label className="field">Amount<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
        <label className="field">How often
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
      </div>
      <label className="field">{frequency === "once" ? "Due date" : "Next due date"}<input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></label>
      <label className="field">Paid from
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Not specified</option>
          {accounts.filter((a) => !a.is_hidden).map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}{a.mask ? ` ••${a.mask}` : ""}</option>)}
        </select>
      </label>
      <label className="toggle"><input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} /><span>Paid automatically</span></label>
      <label className="field">Note<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Account number, website, anything useful" /></label>
      {prefill?.fromRecurring && <p className="meta">Saving this hides the estimated version so it isn’t counted twice.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : bill ? "Save changes" : "Add bill"}</button>
      {bill && <button className="btn-text danger" onClick={remove} disabled={busy}>Delete bill</button>}
    </Sheet>
  );
}

function RecurringSheet({ entry, ledger, onClose, onConvert, go }) {
  const r = entry.recurring;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function hide() {
    setBusy(true);
    try { await ledger.hideRecurring(r.name); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Sheet title={r.name} onClose={onClose}>
      <p className="sheet-figure">≈{money(r.avg)}</p>
      <dl className="detail-list">
        <div><dt>Expected</dt><dd>{dateLabel(entry.date)}</dd></div>
        <div><dt>Usually charged</dt><dd>Around day {r.day} of the month</dd></div>
        <div><dt>Last charge</dt><dd>{money(r.lastAmount)} on {dateLabel(r.lastDate)}</dd></div>
        <div><dt>Category</dt><dd>{categoryName(r.category)}</dd></div>
        {entry.account && <div><dt>Charged to</dt><dd>{entry.account}</dd></div>}
      </dl>
      <p className="meta">Estimated from your transaction history. Turn it into a bill to set the exact amount and date.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button
        className="btn-primary"
        onClick={() => onConvert({ name: r.name, amount: Math.round(r.lastAmount * 100) / 100, frequency: "monthly", next_due: entry.date, account_id: r.accountId, fromRecurring: r.name })}
      >
        Turn into a bill
      </button>
      <button className="btn-quiet wide" onClick={() => { onClose(); go("activity", { query: r.name }); }}>See past charges</button>
      <button className="btn-text danger" onClick={hide} disabled={busy}>Hide from calendar</button>
    </Sheet>
  );
}

function CardSheet({ entry, onClose }) {
  const l = entry.liability;
  const isCard = l.kind === "credit";
  return (
    <Sheet title={entry.name} onClose={onClose}>
      <p className={`sheet-figure ${entry.overdue ? "neg" : ""}`}>{money(entry.amount)}</p>
      <dl className="detail-list">
        <div><dt>Due</dt><dd>{dateLabel(entry.date)}</dd></div>
        {isCard && l.last_statement_balance != null && <div><dt>Statement balance</dt><dd>{money(l.last_statement_balance)}</dd></div>}
        {l.minimum_payment_amount != null && <div><dt>{isCard ? "Minimum payment" : "Monthly payment"}</dt><dd>{money(l.minimum_payment_amount)}</dd></div>}
        {entry.accountObj?.current_balance != null && <div><dt>Current balance</dt><dd>{money(entry.accountObj.current_balance)}</dd></div>}
        {l.last_payment_date && <div><dt>Last payment</dt><dd>{money(l.last_payment_amount)} on {dateLabel(l.last_payment_date)}</dd></div>}
        <div><dt>Status</dt><dd className={entry.overdue ? "neg" : ""}>{entry.paid ? "Statement paid" : entry.overdue ? "Overdue" : "Not yet paid"}</dd></div>
      </dl>
      {isCard && <p className="meta">Paying the full statement balance by the due date avoids interest.</p>}
    </Sheet>
  );
}
