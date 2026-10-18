import { useMemo, useState } from "react";
import Sheet from "../components/Sheet";
import { categoryName, dateLabel, money, moneyWhole, monthLabel } from "../lib/format";
import { isCashAccount, shiftMonth } from "../lib/finance";
import { FREQUENCIES, NTH_OPTIONS, WEEKDAY_NAMES, addDays, buildSchedule, describeSchedule, fromIso, todayIso } from "../lib/upcoming";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const SOURCE_LABEL = { bill: "Bill", income: "Expected income", recurring: "Estimated", card: "Card due", loan: "Loan payment" };
const label = (e) => (e.source === "bill" && e.direction === "in" ? "Income" : e.direction === "transfer" ? "Transfer" : SOURCE_LABEL[e.source]);

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
  const due30 = next30.filter((e) => e.direction === "out").reduce((s, e) => s + e.amount, 0);
  const income30 = next30.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0);
  const transfers30 = next30.filter((e) => e.direction === "transfer").reduce((s, e) => s + e.amount, 0);
  const cash = accounts.filter((a) => isCashAccount(a) && !a.is_hidden).reduce((s, a) => s + Number(a.available_balance ?? a.current_balance ?? 0), 0);
  const projected = cash + income30 - due30 - transfers30;
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
        <button className="btn-primary sm" onClick={() => setOpen({ type: "new" })}>Add</button>
      </header>

      <section className="cover">
        <div>
          <p className="strip-label">Due in the next 30 days</p>
          <p className="figure-lg">{money(due30)}</p>
        </div>
        <dl className="cover-rows">
          <div><dt>Cash in checking</dt><dd>{money(cash)}</dd></div>
          <div><dt>Expected income</dt><dd className="pos">+{money(income30)}</dd></div>
          <div><dt>Payments due</dt><dd className="neg">−{money(due30)}</dd></div>
          {transfers30 > 0 && <div><dt>Transfers to savings</dt><dd className="xfer">−{money(transfers30)}</dd></div>}
          <div className="cover-total"><dt>Checking in 30 days</dt><dd className={projected < 0 ? "neg" : ""}>{money(projected)}</dd></div>
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
            const live = entries.filter((e) => !e.paid);
            const outTotal = live.filter((e) => e.direction === "out").reduce((s, e) => s + e.amount, 0);
            const inTotal = live.filter((e) => e.direction === "in").reduce((s, e) => s + e.amount, 0);
            const xferTotal = live.filter((e) => e.direction === "transfer").reduce((s, e) => s + e.amount, 0);
            const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
            const cls = ["cal-day", iso === today && "today", iso < today && "past", iso === selected && "selected", entries.length && "has"].filter(Boolean).join(" ");
            return (
              <button
                key={iso}
                className={cls}
                onClick={() => setSelected(iso === selected ? null : iso)}
                aria-label={`${dateLabel(iso)}${inTotal ? `, ${money(inTotal)} coming in` : ""}${outTotal ? `, ${money(outTotal)} going out` : ""}${xferTotal ? `, ${money(xferTotal)} to savings` : ""}`}
                aria-pressed={iso === selected}
              >
                <span className="cal-num">{Number(iso.slice(8))}</span>
                {inTotal > 0 && <span className="cal-amt in">{short(inTotal)}</span>}
                {outTotal > 0 && <span className="cal-amt out">{short(outTotal)}</span>}
                {xferTotal > 0 && <span className="cal-amt xfer">{short(xferTotal)}</span>}
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
            {listDate ? "Nothing expected this day." : "Nothing expected in the next 30 days. Add a bill or income, or check back once more transaction history has synced."}
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
                      <span className={`tag tag-${e.direction === "in" ? "in" : e.direction === "transfer" ? "xfer" : e.source}`}>{label(e)}</span>
                      {e.paid ? " Paid" : e.overdue ? " Overdue" : ""}
                      {e.autopay ? (e.direction === "in" ? " Direct deposit" : e.direction === "transfer" ? " Automatic" : " Autopay") : ""}
                      {e.direction === "transfer"
                        ? ` ${e.account ?? "Checking"} → ${e.toAccount ?? "Savings"}`
                        : e.account ? ` ${e.account}` : ""}
                    </span>
                  </div>
                  <span className={`tx-amt ${e.direction === "in" ? "pos" : e.direction === "transfer" ? "xfer" : e.overdue ? "neg" : ""}`}>
                    {e.estimated ? "≈" : ""}{e.direction === "in" ? "+" : ""}{money(e.amount)}
                  </span>
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
      {["recurring", "income", "loan"].includes(open?.type) && (
        <EstimateSheet
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
  const [kind, setKind] = useState(init.kind ?? "expense");
  const [toAccountId, setToAccountId] = useState(init.to_account_id ?? "");
  const [name, setName] = useState(init.name ?? "");
  const [amount, setAmount] = useState(init.amount != null ? String(init.amount) : "");
  const [frequency, setFrequency] = useState(init.frequency ?? "monthly");
  const [nextDue, setNextDue] = useState(init.next_due ?? todayIso());
  const [weekday, setWeekday] = useState(init.weekday ?? 5);
  const [nthWeeks, setNthWeeks] = useState(init.nth_weeks ?? [1, 3]);
  const toggleNth = (n) => setNthWeeks((w) => (w.includes(n) ? w.filter((x) => x !== n) : [...w, n]));
  const [accountId, setAccountId] = useState(init.account_id ?? "");
  const [autopay, setAutopay] = useState(init.autopay ?? false);
  const [notes, setNotes] = useState(init.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    const n = Number(amount.replace(/[$,]/g, ""));
    if (!name.trim()) return setError(`Give the ${kind === "expense" ? "bill" : kind} a name.`);
    if (!Number.isFinite(n) || n < 0) return setError("Enter a valid amount.");
    if (frequency === "monthly_nth" && !nthWeeks.length) return setError("Pick at least one week of the month.");
    setBusy(true);
    setError(null);
    try {
      await saveBill({
        ...(bill ? { id: bill.id } : {}),
        kind, name: name.trim(), amount: n, frequency, next_due: nextDue,
        weekday: frequency === "monthly_nth" ? Number(weekday) : null,
        nth_weeks: frequency === "monthly_nth" ? nthWeeks : null,
        account_id: accountId || null, to_account_id: kind === "transfer" ? toAccountId || null : null,
        autopay, notes: notes.trim() || null,
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
    <Sheet title={bill ? { income: "Edit income", transfer: "Edit transfer", expense: "Edit bill" }[kind] : "Add to calendar"} onClose={onClose}>
      <div className="seg three" role="radiogroup" aria-label="Type">
        <button role="radio" aria-checked={kind === "expense"} className={kind === "expense" ? "on out" : ""} onClick={() => setKind("expense")}>Payment</button>
        <button role="radio" aria-checked={kind === "income"} className={kind === "income" ? "on in" : ""} onClick={() => setKind("income")}>Income</button>
        <button role="radio" aria-checked={kind === "transfer"} className={kind === "transfer" ? "on xfer" : ""} onClick={() => setKind("transfer")}>Transfer</button>
      </div>
      <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder={{ income: "Paycheck, client payment, rental income…", transfer: "Transfer to savings", expense: "Rent, truck payment, insurance…" }[kind]} /></label>
      <div className="field-row">
        <label className="field">Amount<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></label>
        <label className="field">How often
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
      </div>
      {frequency === "monthly_nth" && (
        <div className="field">
          <span>Which ones</span>
          <div className="chips" role="group" aria-label="Weeks of the month">
            {NTH_OPTIONS.map((o) => (
              <button key={o.n} type="button" className={nthWeeks.includes(o.n) ? "chip on" : "chip"} aria-pressed={nthWeeks.includes(o.n)} onClick={() => toggleNth(o.n)}>{o.label}</button>
            ))}
          </div>
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} aria-label="Weekday">
            {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          {nthWeeks.length > 0 && <span className="meta">{describeSchedule({ frequency, weekday, nth_weeks: nthWeeks })}</span>}
        </div>
      )}
      <label className="field">{frequency === "once" ? "Due date" : frequency === "monthly_nth" ? "Starting" : "Next due date"}<input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></label>
      <label className="field">{{ income: "Deposited to", transfer: "From", expense: "Paid from" }[kind]}
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Not specified</option>
          {accounts.filter((a) => !a.is_hidden).map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}{a.mask ? ` ••${a.mask}` : ""}</option>)}
        </select>
      </label>
      {kind === "transfer" && (
        <label className="field">To
          <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="">Not specified</option>
            {accounts.filter((a) => !a.is_hidden && a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name}{a.mask ? ` ••${a.mask}` : ""}</option>)}
          </select>
        </label>
      )}
      <label className="toggle"><input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} /><span>{{ income: "Direct deposit", transfer: "Automatic transfer", expense: "Paid automatically" }[kind]}</span></label>
      <label className="field">Note<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Account number, website, anything useful" /></label>
      {prefill?.fromRecurring && <p className="meta">Saving this hides the estimated version so it isn’t counted twice.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : bill ? "Save changes" : { income: "Add income", transfer: "Add transfer", expense: "Add bill" }[kind]}</button>
      {bill && <button className="btn-text danger" onClick={remove} disabled={busy}>Delete</button>}
    </Sheet>
  );
}

function EstimateSheet({ entry, ledger, onClose, onConvert, go }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isIncome = entry.source === "income";
  const isLoan = entry.source === "loan";
  const src = entry.recurring ?? entry.income ?? entry.loan;
  const lastAmount = src.lastAmount ?? src.amount;
  const freq = isIncome ? src.frequency : "monthly";
  const freqText = { weekly: "Every week", biweekly: "Every 2 weeks", semimonthly: "Twice a month", monthly: `Around day ${src.day} of the month` }[freq];

  async function hide() {
    setBusy(true);
    try { await ledger.hideRecurring(entry.name); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Sheet title={entry.name} onClose={onClose}>
      <p className={`sheet-figure ${isIncome ? "pos" : ""}`}>≈{isIncome ? "+" : ""}{money(entry.amount)}</p>
      <dl className="detail-list">
        <div><dt>Expected</dt><dd>{dateLabel(entry.date)}</dd></div>
        <div><dt>Schedule</dt><dd>{freqText}</dd></div>
        <div><dt>Last {isIncome ? "deposit" : "payment"}</dt><dd>{money(lastAmount)} on {dateLabel(src.lastDate)}</dd></div>
        {isIncome && !src.steady && <div><dt>Amount</dt><dd>Varies, averaged over last 3</dd></div>}
        {isLoan && <div><dt>Loan balance</dt><dd>{money(src.account.current_balance)}</dd></div>}
        {entry.recurring && <div><dt>Category</dt><dd>{categoryName(src.category)}</dd></div>}
        {entry.account && <div><dt>{isIncome ? "Deposited to" : "Charged to"}</dt><dd>{entry.account}</dd></div>}
      </dl>
      <p className="meta">
        {isLoan
          ? "Your bank doesn’t report due dates for this loan, so this is projected from your last payment. Turn it into a bill to set the exact due date."
          : `Estimated from your transaction history. Turn it into ${isIncome ? "an income entry" : "a bill"} to set the exact amount and date.`}
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button
        className="btn-primary"
        onClick={() => onConvert({
          name: entry.name, amount: Math.round(entry.amount * 100) / 100,
          frequency: freq === "semimonthly" ? "biweekly" : freq, next_due: entry.date,
          account_id: src.accountId ?? null, kind: isIncome ? "income" : "expense", fromRecurring: entry.name,
        })}
      >
        {isIncome ? "Turn into income entry" : "Turn into a bill"}
      </button>
      {!isLoan && <button className="btn-quiet wide" onClick={() => { onClose(); go("activity", { query: entry.name.split(" ")[0] }); }}>See past {isIncome ? "deposits" : "charges"}</button>}
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
