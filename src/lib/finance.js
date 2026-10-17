// Plaid convention: positive amount = money leaving the account
export const DEBT_TYPES = ["credit", "loan"];
const NON_SPENDING = ["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "INCOME"];

export const txCategory = (t) => t.user_category || t.category_primary || "OTHER";
export const monthKey = (iso) => iso.slice(0, 7);
export const currentMonthKey = () => new Date().toLocaleDateString("en-CA").slice(0, 7);

export function shiftMonth(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export const isSpending = (t) => !t.is_excluded && t.amount > 0 && !NON_SPENDING.includes(txCategory(t));
export const isIncome = (t) => !t.is_excluded && t.amount < 0 && txCategory(t) === "INCOME";

export function balanceSummary(accounts) {
  let assets = 0, debts = 0, creditUsed = 0, creditLimit = 0;
  for (const a of accounts) {
    if (a.is_hidden) continue;
    const bal = Number(a.current_balance ?? 0);
    if (DEBT_TYPES.includes(a.type)) {
      debts += bal;
      if (a.type === "credit" && a.credit_limit) { creditUsed += bal; creditLimit += Number(a.credit_limit); }
    } else assets += bal;
  }
  return { assets, debts, netWorth: assets - debts, utilization: creditLimit ? creditUsed / creditLimit : null, creditUsed, creditLimit };
}

export function netWorthHistory(snapshots, accounts) {
  const typeById = new Map(accounts.filter((a) => !a.is_hidden).map((a) => [a.id, a.type]));
  const byDate = new Map();
  for (const s of snapshots) {
    const type = typeById.get(s.account_id);
    if (!type) continue;
    const sign = DEBT_TYPES.includes(type) ? -1 : 1;
    byDate.set(s.snapshot_date, (byDate.get(s.snapshot_date) ?? 0) + sign * Number(s.current_balance ?? 0));
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

export function monthTotals(transactions, key) {
  let spent = 0, income = 0;
  for (const t of transactions) {
    if (monthKey(t.date) !== key) continue;
    if (isSpending(t)) spent += Number(t.amount);
    else if (isIncome(t)) income += -Number(t.amount);
  }
  return { spent, income, net: income - spent };
}

export function spendingByCategory(transactions, key) {
  const totals = new Map();
  for (const t of transactions) {
    if (monthKey(t.date) !== key || !isSpending(t)) continue;
    const c = txCategory(t);
    totals.set(c, (totals.get(c) ?? 0) + Number(t.amount));
  }
  return [...totals.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

export function topMerchants(transactions, key, limit = 6) {
  const totals = new Map();
  for (const t of transactions) {
    if (monthKey(t.date) !== key || !isSpending(t)) continue;
    const name = t.merchant_name || t.name;
    const cur = totals.get(name) ?? { name, total: 0, count: 0 };
    cur.total += Number(t.amount);
    cur.count += 1;
    totals.set(name, cur);
  }
  return [...totals.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

// Cumulative spending by day of month, for comparing this month against last
export function cumulativeByDay(transactions, key) {
  const [y, m] = key.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const daily = new Array(days).fill(0);
  for (const t of transactions) {
    if (monthKey(t.date) !== key || !isSpending(t)) continue;
    daily[Number(t.date.slice(8, 10)) - 1] += Number(t.amount);
  }
  let run = 0;
  return daily.map((v) => (run += v));
}

// Merchants charged in at least 3 of the last 4 months with steady amounts
export function recurringCharges(transactions) {
  const months = [0, 1, 2, 3].map((i) => shiftMonth(currentMonthKey(), -i));
  const byMerchant = new Map();
  for (const t of transactions) {
    if (!isSpending(t) || !months.includes(monthKey(t.date))) continue;
    const name = t.merchant_name || t.name;
    if (!byMerchant.has(name)) byMerchant.set(name, []);
    byMerchant.get(name).push(t);
  }
  const out = [];
  for (const [name, txs] of byMerchant) {
    const perMonth = new Map();
    for (const t of txs) perMonth.set(monthKey(t.date), (perMonth.get(monthKey(t.date)) ?? 0) + Number(t.amount));
    if (perMonth.size < 3) continue;
    const amounts = [...perMonth.values()];
    const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    const spread = Math.max(...amounts) - Math.min(...amounts);
    if (spread > Math.max(5, avg * 0.25)) continue;
    const last = txs.reduce((a, b) => (a.date > b.date ? a : b));
    out.push({ name, avg, lastDate: last.date, category: txCategory(last) });
  }
  return out.sort((a, b) => b.avg - a.avg);
}
