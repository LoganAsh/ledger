import { useMemo, useState } from "react";
import LineChart from "../components/LineChart";
import Sheet from "../components/Sheet";
import { CATEGORY_KEYS, categoryName, dateLabel, money, moneyWhole, monthLabel } from "../lib/format";
import { cumulativeByDay, currentMonthKey, isSpending, monthKey, monthTotals, recurringCharges, shiftMonth, spendingByCategory, topMerchants } from "../lib/finance";

const PERIODS = [{ id: "month", label: "Month" }, { id: 3, label: "3-mo avg" }, { id: 6, label: "6-mo avg" }, { id: 12, label: "12-mo avg" }];

const BUDGETABLE = CATEGORY_KEYS.filter((c) => !["INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"].includes(c));

export default function Spending({ ledger, go }) {
  const { transactions, budgets, saveBudget, deleteBudget } = ledger;
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [period, setPeriod] = useState("month");
  const [editingBudgets, setEditingBudgets] = useState(false);

  const earliest = transactions.at(-1)?.date.slice(0, 7) ?? thisMonth;
  // A month that history starts partway through would drag averages down
  const firstDate = transactions.at(-1)?.date;
  const firstFullMonth = firstDate && Number(firstDate.slice(8, 10)) > 5 ? shiftMonth(earliest, 1) : earliest;
  const prev = shiftMonth(month, -1);
  const totals = monthTotals(transactions, month);
  const prevTotals = monthTotals(transactions, prev);
  const cats = useMemo(() => spendingByCategory(transactions, month), [transactions, month]);
  const prevCats = useMemo(() => new Map(spendingByCategory(transactions, prev).map((c) => [c.category, c.total])), [transactions, prev]);
  const merchants = useMemo(() => topMerchants(transactions, month), [transactions, month]);
  const recurring = useMemo(() => recurringCharges(transactions), [transactions]);
  const budgetMap = new Map(budgets.filter((b) => b.period !== "yearly").map((b) => [b.category, Number(b.monthly_limit)]));
  const yearlyMap = new Map(budgets.filter((b) => b.period === "yearly").map((b) => [b.category, Number(b.monthly_limit)]));
  // Monthly equivalents, for comparing against averages
  const avgBudgetMap = new Map([...budgetMap, ...[...yearlyMap].map(([c, v]) => [c, v / 12])]);
  // Year-to-date spending (through the selected month) for categories on a yearly budget
  const ytd = useMemo(() => {
    const out = new Map();
    if (!yearlyMap.size) return out;
    const year = month.slice(0, 4);
    for (let m = `${year}-01`; m <= month; m = shiftMonth(m, 1)) {
      for (const c of spendingByCategory(transactions, m)) if (yearlyMap.has(c.category)) out.set(c.category, (out.get(c.category) ?? 0) + c.total);
    }
    return out;
  }, [transactions, month, budgets]); // eslint-disable-line react-hooks/exhaustive-deps

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

      <div className="seg four" role="radiogroup" aria-label="Time period">
        {PERIODS.map((p) => (
          <button key={p.id} role="radio" aria-checked={period === p.id} className={period === p.id ? "on plain" : ""} onClick={() => setPeriod(p.id)}>{p.label}</button>
        ))}
      </div>

      {period !== "month" ? (
        <AverageView n={period} transactions={transactions} budgetMap={avgBudgetMap} yearlyMap={yearlyMap} earliest={firstFullMonth} go={go} onEditBudgets={() => setEditingBudgets(true)} hasBudgets={budgets.length > 0} />
      ) : (
      <>
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
                  {yearlyMap.has(category) && (() => {
                    const yl = yearlyMap.get(category);
                    const spent = ytd.get(category) ?? 0;
                    const yOver = spent > yl;
                    return (
                      <span className="year-budget">
                        <span className="meter thin"><span className={yOver ? "over" : ""} style={{ width: `${Math.min(spent / yl, 1) * 100}%` }} /></span>
                        <span className={`cat-sub ${yOver ? "neg" : ""}`}>
                          {money(spent)} of {moneyWhole(yl)} yearly budget{isCurrent ? (yOver ? ` · ${money(spent - yl)} over` : ` · ${money(yl - spent)} left for ${month.slice(0, 4)}`) : ` by end of ${monthLabel(month).split(" ")[0]}`}
                        </span>
                      </span>
                    );
                  })()}
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

      </>
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

// Monthly averages over the last n complete months (the current month is left out)
function AverageView({ n, transactions, budgetMap, yearlyMap, earliest, go, onEditBudgets, hasBudgets }) {
  const thisMonth = currentMonthKey();
  const months = useMemo(() => {
    const all = Array.from({ length: n }, (_, i) => shiftMonth(thisMonth, -(i + 1))).reverse();
    return all.filter((m) => m >= earliest);
  }, [n, thisMonth, earliest]);
  const count = months.length || 1;

  const data = useMemo(() => {
    const perMonth = months.map((m) => ({ month: m, ...monthTotals(transactions, m) }));
    const cats = new Map();
    for (const m of months) for (const c of spendingByCategory(transactions, m)) cats.set(c.category, (cats.get(c.category) ?? 0) + c.total);
    const now = new Map(spendingByCategory(transactions, thisMonth).map((c) => [c.category, c.total]));
    const merchants = new Map();
    for (const t of transactions) {
      if (!isSpending(t) || !months.includes(monthKey(t.date))) continue;
      const name = t.merchant_name || t.name;
      const cur = merchants.get(name) ?? { name, total: 0, count: 0 };
      cur.total += Number(t.amount);
      cur.count += 1;
      merchants.set(name, cur);
    }
    return {
      perMonth,
      spent: perMonth.reduce((s, m) => s + m.spent, 0) / count,
      income: perMonth.reduce((s, m) => s + m.income, 0) / count,
      cats: [...cats.entries()].map(([category, total]) => ({ category, avg: total / count, now: now.get(category) ?? 0 })).sort((a, b) => b.avg - a.avg),
      merchants: [...merchants.values()].map((m) => ({ ...m, avg: m.total / count })).sort((a, b) => b.total - a.total).slice(0, 8),
    };
  }, [transactions, months, count, thisMonth]);

  if (!months.length) return <p className="meta empty-inline">Not enough history yet for averages. Check back after a full month of transactions.</p>;

  const range = months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0]).split(" ")[0]} to ${monthLabel(months.at(-1))}`;
  const barMax = Math.max(...data.perMonth.map((m) => m.spent), 1);
  const catMax = Math.max(...data.cats.map((c) => Math.max(c.avg, c.now, budgetMap.get(c.category) ?? 0)), 1);
  const short = months.length < n;

  return (
    <>
      <section className="block">
        <p className="strip-label">Average monthly spending</p>
        <p className="figure-lg">{money(data.spent)}</p>
        <p className="meta">{range}{short ? `. Only ${months.length} month${months.length > 1 ? "s" : ""} of history so far.` : "."}</p>
        <div className="month-bars" role="img" aria-label="Spending by month">
          {data.perMonth.map((m) => (
            <div key={m.month} className="month-bar">
              <span className="mb-fill" style={{ height: `${(m.spent / barMax) * 100}%` }} title={`${monthLabel(m.month)}: ${money(m.spent)}`} />
              <span className="mb-label">{monthLabel(m.month).slice(0, 3)}</span>
            </div>
          ))}
        </div>
        <dl className="stat-row">
          <div><dt>Avg income</dt><dd>{moneyWhole(data.income)}</dd></div>
          <div><dt>Avg net</dt><dd className={data.income - data.spent < 0 ? "neg" : "pos"}>{moneyWhole(data.income - data.spent)}</dd></div>
        </dl>
      </section>

      <section className="block">
        <div className="block-head static">
          <h2>By category, per month</h2>
          <button className="btn-text" onClick={onEditBudgets}>{hasBudgets ? "Edit budgets" : "Set budgets"}</button>
        </div>
        <p className="meta">The dark tick shows this month so far.</p>
        <ul className="cat-list">
          {data.cats.map(({ category, avg, now }) => {
            const limit = budgetMap.get(category);
            return (
              <li key={category}>
                <button className="cat" onClick={() => go("activity", { category })}>
                  <div className="cat-top">
                    <span>{categoryName(category)}</span>
                    <span>{money(avg)}{limit != null && <span className="of"> vs {moneyWhole(limit)}{yearlyMap.has(category) ? `/mo (${moneyWhole(yearlyMap.get(category))}/yr)` : " budget"}</span>}</span>
                  </div>
                  <div className="bar">
                    <span className={limit != null && avg > limit ? "over" : ""} style={{ width: `${(avg / catMax) * 100}%` }} />
                    <i className="limit" style={{ left: `${Math.min(now / catMax, 1) * 100}%` }} />
                  </div>
                  <span className={`cat-sub ${now > avg ? "neg" : ""}`}>
                    {moneyWhole(now)} so far this month{avg > 0 ? ` (${Math.round((now / avg) * 100)}% of average)` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {data.merchants.length > 0 && (
        <section className="block">
          <div className="block-head static"><h2>Top merchants, per month</h2></div>
          <ul className="plain-list">
            {data.merchants.map((m) => (
              <li key={m.name}>
                <span>{m.name}<span className="tx-sub"> {(m.count / count).toFixed(m.count / count < 10 ? 1 : 0)} charges/mo</span></span>
                <span className="num">{money(m.avg)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function BudgetSheet({ budgets, onClose, saveBudget, deleteBudget, transactions }) {
  const [values, setValues] = useState(() => Object.fromEntries(budgets.map((b) => [b.category, String(b.monthly_limit)])));
  const [periods, setPeriods] = useState(() => Object.fromEntries(budgets.map((b) => [b.category, b.period ?? "monthly"])));
  const periodOf = (cat) => periods[cat] ?? "monthly";
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
          if (!existing || Number(existing.monthly_limit) !== n || (existing.period ?? "monthly") !== periodOf(cat)) await saveBudget(cat, n, periodOf(cat));
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
      <p className="meta">Leave a category blank to skip it. Switch to /yr for spending that’s lumpy, like travel or car repairs: it’s tracked against a budget for the whole calendar year. Hints come from your last three months.</p>
      <ul className="budget-list">
        {BUDGETABLE.map((cat) => {
          const yearly = periodOf(cat) === "yearly";
          const hint = averages[cat] ? (yearly ? `about ${moneyWhole(averages[cat] * 12)}/yr` : `avg ${moneyWhole(averages[cat])}/mo`) : null;
          return (
            <li key={cat} className="budget-row">
              <span className="budget-name">{categoryName(cat)}{hint ? <span className="tx-sub"> {hint}</span> : null}</span>
              <div className="budget-controls">
                <input
                  inputMode="decimal"
                  placeholder="—"
                  aria-label={`${categoryName(cat)} budget`}
                  value={values[cat] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [cat]: e.target.value }))}
                />
                <div className="mini-seg" role="radiogroup" aria-label={`${categoryName(cat)} budget period`}>
                  <button type="button" role="radio" aria-checked={!yearly} className={!yearly ? "on" : ""} onClick={() => setPeriods((p) => ({ ...p, [cat]: "monthly" }))}>/mo</button>
                  <button type="button" role="radio" aria-checked={yearly} className={yearly ? "on" : ""} onClick={() => setPeriods((p) => ({ ...p, [cat]: "yearly" }))}>/yr</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save budgets"}</button>
    </Sheet>
  );
}
