import { useMemo, useState } from "react";
import LineChart from "../components/LineChart";
import Sheet from "../components/Sheet";
import { CATEGORY_KEYS, categoryName, dateLabel, money, moneyWhole, monthLabel } from "../lib/format";
import { cumulativeByDay, currentMonthKey, monthTotals, recurringCharges, shiftMonth, spendingByCategory, topMerchants } from "../lib/finance";

const BUDGETABLE = CATEGORY_KEYS.filter((c) => !["INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"].includes(c));

export default function Spending({ ledger, go }) {
  const { transactions, budgets, saveBudget, deleteBudget } = ledger;
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [editingBudgets, setEditingBudgets] = useState(false);

  const earliest = transactions.at(-1)?.date.slice(0, 7) ?? thisMonth;
  const prev = shiftMonth(month, -1);
  const totals = monthTotals(transactions, month);
  const prevTotals = monthTotals(transactions, prev);
  const cats = useMemo(() => spendingByCategory(transactions, month), [transactions, month]);
  const prevCats = useMemo(() => new Map(spendingByCategory(transactions, prev).map((c) => [c.category, c.total])), [transactions, prev]);
  const merchants = useMemo(() => topMerchants(transactions, month), [transactions, month]);
  const recurring = useMemo(() => recurringCharges(transactions), [transactions]);
  const budgetMap = new Map(budgets.map((b) => [b.category, Number(b.monthly_limit)]));

  const isCurrent = month === thisMonth;
  const cum = cumulativeByDay(transactions, month);
  const shown = isCurrent ? cum.slice(0, new Date().getDate()) : cum;
  const prevCum = cumulativeByDay(transactions, prev);
  const change = prevTotals.spent ? (totals.spent - prevTotals.spent) / prevTotals.spent : null;

  // Show budgeted categories even if nothing has been spent yet
  const rows = [...cats];
  for (const b of budgets) if (!rows.some((r) => r.category === b.category)) rows.push({ category: b.category, total: 0 });
  const max = Math.max(...rows.map((r) => Math.max(r.total, budgetMap.get(r.category) ?? 0)), 1);
  const recurringTotal = recurring.reduce((s, r) => s + r.avg, 0);

  return (
    <>
      <header className="page-head">
        <h1 className="page-title">Spending</h1>
      </header>

      <div className="month-nav">
        <button className="btn-quiet" onClick={() => setMonth(prev)} disabled={month <= earliest} aria-label="Previous month">‹</button>
        <span>{monthLabel(month)}</span>
        <button className="btn-quiet" onClick={() => setMonth(shiftMonth(month, 1))} disabled={isCurrent} aria-label="Next month">›</button>
      </div>

      <section className="block">
        <p className="strip-label">{isCurrent ? "Spent so far" : "Spent"}</p>
        <p className="figure-lg">{money(totals.spent)}</p>
        {change != null && (
          <p className="meta">
            {isCurrent ? `${monthLabel(prev).split(" ")[0]} total was ${moneyWhole(prevTotals.spent)}.` : `${change > 0 ? "Up" : "Down"} ${Math.abs(Math.round(change * 100))}% from ${monthLabel(prev).split(" ")[0]}.`}
          </p>
        )}
        {shown.length > 1 && (
          <>
            <LineChart
              ariaLabel={`Cumulative spending in ${monthLabel(month)} compared to ${monthLabel(prev)}`}
              height={100}
              series={[{ values: prevCum, className: "line-ghost" }, { values: shown, className: "line-main", fill: true }]}
            />
            <p className="legend"><span className="key-main" />{monthLabel(month).split(" ")[0]}<span className="key-ghost" />{monthLabel(prev).split(" ")[0]}</p>
          </>
        )}
        <dl className="stat-row">
          <div><dt>Income</dt><dd>{moneyWhole(totals.income)}</dd></div>
          <div><dt>Net</dt><dd className={totals.net < 0 ? "neg" : "pos"}>{moneyWhole(totals.net)}</dd></div>
        </dl>
      </section>

      <section className="block">
        <div className="block-head static">
          <h2>By category</h2>
          <button className="btn-text" onClick={() => setEditingBudgets(true)}>{budgets.length ? "Edit budgets" : "Set budgets"}</button>
        </div>
        {!rows.length && <p className="meta">No spending recorded for this month.</p>}
        <ul className="cat-list">
          {rows.map(({ category, total }) => {
            const limit = budgetMap.get(category);
            const over = limit != null && total > limit;
            const before = prevCats.get(category);
            return (
              <li key={category}>
                <button className="cat" onClick={() => go("activity", { category, month })}>
                  <div className="cat-top">
                    <span>{categoryName(category)}</span>
                    <span className={over ? "neg" : ""}>{money(total)}{limit != null && <span className="of"> of {moneyWhole(limit)}</span>}</span>
                  </div>
                  <div className="bar">
                    <span className={over ? "over" : ""} style={{ width: `${(total / max) * 100}%` }} />
                    {limit != null && <i className="limit" style={{ left: `${(limit / max) * 100}%` }} />}
                  </div>
                  {before != null && !isCurrent && <span className="cat-sub">{moneyWhole(before)} the month before</span>}
                  {limit != null && isCurrent && <span className={`cat-sub ${over ? "neg" : ""}`}>{over ? `${money(total - limit)} over budget` : `${money(limit - total)} left`}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {merchants.length > 0 && (
        <section className="block">
          <div className="block-head static"><h2>Where it went</h2></div>
          <ul className="plain-list">
            {merchants.map((m) => (
              <li key={m.name}>
                <span>{m.name}<span className="tx-sub"> {m.count} {m.count === 1 ? "charge" : "charges"}</span></span>
                <span className="num">{money(m.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recurring.length > 0 && (
        <section className="block">
          <div className="block-head static">
            <h2>Recurring charges</h2>
            <span className="figure-sm">{moneyWhole(recurringTotal)}/mo</span>
          </div>
          <p className="meta">Charges that showed up with steady amounts in at least three of the last four months.</p>
          <ul className="plain-list">
            {recurring.map((r) => (
              <li key={r.name}>
                <span>{r.name}<span className="tx-sub"> last {dateLabel(r.lastDate)}</span></span>
                <span className="num">{money(r.avg)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editingBudgets && (
        <BudgetSheet budgets={budgets} onClose={() => setEditingBudgets(false)} saveBudget={saveBudget} deleteBudget={deleteBudget} transactions={transactions} />
      )}
    </>
  );
}

function BudgetSheet({ budgets, onClose, saveBudget, deleteBudget, transactions }) {
  const [values, setValues] = useState(() => Object.fromEntries(budgets.map((b) => [b.category, String(b.monthly_limit)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Three-month average as a starting point for each category
  const averages = useMemo(() => {
    const m = currentMonthKey();
    const months = [1, 2, 3].map((i) => shiftMonth(m, -i));
    const out = {};
    for (const k of months) for (const c of spendingByCategory(transactions, k)) out[c.category] = (out[c.category] ?? 0) + c.total / 3;
    return out;
  }, [transactions]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      for (const cat of BUDGETABLE) {
        const raw = (values[cat] ?? "").trim();
        const existing = budgets.find((b) => b.category === cat);
        if (!raw && existing) await deleteBudget(existing.id);
        else if (raw) {
          const n = Number(raw.replace(/[$,]/g, ""));
          if (!Number.isFinite(n) || n < 0) throw new Error(`Enter a valid amount for ${categoryName(cat)}.`);
          if (!existing || Number(existing.monthly_limit) !== n) await saveBudget(cat, n);
        }
      }
      onClose();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <Sheet title="Monthly budgets" onClose={onClose}>
      <p className="meta">Leave a category blank to skip it. The hint under each is your average from the last three months.</p>
      <ul className="budget-list">
        {BUDGETABLE.map((cat) => (
          <li key={cat}>
            <label>
              <span>{categoryName(cat)}{averages[cat] ? <span className="tx-sub"> avg {moneyWhole(averages[cat])}</span> : null}</span>
              <input inputMode="decimal" placeholder="—" value={values[cat] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [cat]: e.target.value }))} />
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save budgets"}</button>
    </Sheet>
  );
}
