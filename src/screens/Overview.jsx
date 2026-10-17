import LineChart from "../components/LineChart";
import { categoryName, dateLabel, money, moneyWhole, timeAgo } from "../lib/format";
import { addDays, buildSchedule, todayIso } from "../lib/upcoming";
import { balanceSummary, cumulativeByDay, currentMonthKey, monthTotals, netWorthHistory, shiftMonth, txCategory } from "../lib/finance";

export default function Overview({ ledger, plaid, go }) {
  const { accounts, items, transactions, snapshots, syncing, sync } = ledger;
  const lastSynced = items.map((i) => i.last_synced_at).filter(Boolean).sort().at(-1);
  const needsLogin = items.filter((i) => i.status === "login_required" || i.status === "error");

  if (!accounts.length) {
    return (
      <section className="empty">
        <h1>Start your ledger</h1>
        <p>Link a checking, savings or credit card account. You’ll sign in through Plaid, and your bank password never touches this app.</p>
        <button className="btn-primary" onClick={() => plaid.start()} disabled={plaid.busy}>
          {plaid.busy ? "Opening…" : "Link an account"}
        </button>
      </section>
    );
  }

  const bal = balanceSummary(accounts);
  const history = netWorthHistory(snapshots, accounts);
  const month = currentMonthKey();
  const now = monthTotals(transactions, month);
  const today = new Date().getDate();
  const thisCum = cumulativeByDay(transactions, month).slice(0, today);
  const lastCum = cumulativeByDay(transactions, shiftMonth(month, -1));
  const lastAtSameDay = lastCum[Math.min(today, lastCum.length) - 1] ?? 0;
  const pace = now.spent - lastAtSameDay;
  const recent = transactions.slice(0, 6);
  const t0 = todayIso();
  const soon = buildSchedule(ledger, t0, addDays(t0, 7)).filter((e) => !e.paid);
  const soonTotal = soon.reduce((s, e) => s + e.amount, 0);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="meta">Updated {timeAgo(lastSynced)}</p>
        </div>
        <button className="btn-quiet" onClick={() => sync()} disabled={syncing}>{syncing ? "Refreshing…" : "Refresh"}</button>
      </header>

      {needsLogin.map((i) => (
        <div key={i.id} className="attention">
          <span>{i.institution_name ?? "A bank"} needs you to sign in again before it can update.</span>
          <button className="btn-quiet" onClick={() => plaid.start(i.id)} disabled={plaid.busy}>Sign in</button>
        </div>
      ))}

      <section className="ledger-strip" aria-label="Net worth">
        <p className="strip-label">Net worth</p>
        <p className={`strip-figure ${bal.netWorth < 0 ? "neg" : ""}`}>{moneyWhole(bal.netWorth)}</p>
        <dl className="strip-rows">
          <div><dt>Cash & investments</dt><dd>{money(bal.assets)}</dd></div>
          <div><dt>Cards & loans</dt><dd className="neg">−{money(bal.debts)}</dd></div>
        </dl>
        {history.length >= 2 ? (
          <LineChart
            ariaLabel="Net worth over time"
            series={[{ values: history.map((h) => h.value), className: "line-main", fill: true }]}
            labels={[dateLabel(history[0].date), dateLabel(history.at(-1).date)]}
          />
        ) : (
          <p className="meta strip-note">Your net worth trend fills in as daily balances are recorded.</p>
        )}
      </section>

      {soon.length > 0 && (
        <section className="block">
          <button className="block-head" onClick={() => go("upcoming")}>
            <h2>Due this week</h2>
            <span className="link">{moneyWhole(soonTotal)}</span>
          </button>
          <ul className="plain-list">
            {soon.slice(0, 4).map((e) => (
              <li key={e.key}>
                <span>{e.name}<span className="tx-sub"> {dateLabel(e.date)}{e.estimated ? ", estimated" : ""}</span></span>
                <span className={`num ${e.overdue ? "neg" : ""}`}>{money(e.amount)}</span>
              </li>
            ))}
          </ul>
          {soon.length > 4 && <p className="meta">{soon.length - 4} more this week.</p>}
        </section>
      )}

      <section className="block">
        <button className="block-head" onClick={() => go("spending")}>
          <h2>This month</h2>
          <span className="link">Spending</span>
        </button>
        <dl className="stat-row">
          <div><dt>Spent</dt><dd>{moneyWhole(now.spent)}</dd></div>
          <div><dt>Income</dt><dd>{moneyWhole(now.income)}</dd></div>
          <div><dt>Net</dt><dd className={now.net < 0 ? "neg" : "pos"}>{moneyWhole(now.net)}</dd></div>
        </dl>
        {lastAtSameDay > 0 && (
          <p className="meta">
            {pace > 0 ? `${moneyWhole(pace)} more` : `${moneyWhole(-pace)} less`} than this point last month.
          </p>
        )}
        {thisCum.length > 1 && lastCum.length > 1 && (
          <LineChart
            ariaLabel="Spending this month compared to last month"
            height={80}
            series={[
              { values: lastCum, className: "line-ghost" },
              { values: thisCum, className: "line-main" },
            ]}
          />
        )}
      </section>

      {bal.utilization != null && (
        <section className="block">
          <div className="block-head static"><h2>Credit used</h2><span className="figure-sm">{Math.round(bal.utilization * 100)}%</span></div>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bal.utilization * 100)}>
            <span className={bal.utilization > 0.3 ? "warn" : ""} style={{ width: `${Math.min(bal.utilization * 100, 100)}%` }} />
          </div>
          <p className="meta">{money(bal.creditUsed)} of {moneyWhole(bal.creditLimit)} in limits. Under 30% is generally best for your credit score.</p>
        </section>
      )}

      <section className="block">
        <button className="block-head" onClick={() => go("activity")}>
          <h2>Recent activity</h2>
          <span className="link">See all</span>
        </button>
        {recent.length ? (
          <ul className="tx-list">
            {recent.map((t) => (
              <li key={t.id} className="tx">
                <div className="tx-main">
                  <span className="tx-name">{t.merchant_name || t.name}</span>
                  <span className="tx-sub">{dateLabel(t.date)} · {categoryName(txCategory(t))}{t.pending ? " · Pending" : ""}</span>
                </div>
                <span className={`tx-amt ${t.amount < 0 ? "pos" : ""}`}>{t.amount < 0 ? "+" : ""}{money(Math.abs(t.amount))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="meta">Transactions appear here after your first sync finishes.</p>
        )}
      </section>
    </>
  );
}
