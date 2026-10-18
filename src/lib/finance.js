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

// Everyday spending accounts; other depository subtypes (savings, money market, CD, HSA) count as savings
const CASH_SUBTYPES = ["checking", "paypal", "prepaid", "cash management", "ebt"];

// Vehicles and other property the user values by hand
export const realAssetTotal = (realAssets = []) => realAssets.filter((a) => !a.is_hidden).reduce((s, a) => s + Number(a.value ?? 0), 0);

export function balanceSummary(accounts, realAssets = []) {
  let assets = 0, cash = 0, savings = 0, debts = 0, creditUsed = 0, creditLimit = 0;
  for (const a of accounts) {
    if (a.is_hidden) continue;
    const bal = Number(a.current_balance ?? 0);
    if (DEBT_TYPES.includes(a.type)) {
      debts += bal;
      if (a.type === "credit" && a.credit_limit) { creditUsed += bal; creditLimit += Number(a.credit_limit); }
    } else {
      assets += bal;
      if (a.type === "depository" && CASH_SUBTYPES.includes(a.subtype ?? "checking")) cash += bal;
      else savings += bal;
    }
  }
  const property = realAssetTotal(realAssets);
  return { assets, cash, savings, property, debts, netWorth: assets + property - debts, utilization: creditLimit ? creditUsed / creditLimit : null, creditUsed, creditLimit };
}

// Account history plus today's value of vehicles and property (their past values aren't tracked)
export function netWorthHistory(snapshots, accounts, realAssets = []) {
  const property = realAssetTotal(realAssets);
  const typeById = new Map(accounts.filter((a) => !a.is_hidden).map((a) => [a.id, a.type]));
  const byDate = new Map();
  for (const s of snapshots) {
    const type = typeById.get(s.account_id);
    if (!type) continue;
    const sign = DEBT_TYPES.includes(type) ? -1 : 1;
    byDate.set(s.snapshot_date, (byDate.get(s.snapshot_date) ?? 0) + sign * Number(s.current_balance ?? 0));
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value: value + property }));
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
    // Typical billing day: median day-of-month across charges
    const days = txs.map((t) => Number(t.date.slice(8, 10))).sort((a, b) => a - b);
    const day = days[Math.floor(days.length / 2)];
    out.push({ name, avg, lastAmount: Number(last.amount), lastDate: last.date, day, accountId: last.account_id, category: txCategory(last) });
  }
  return out.sort((a, b) => b.avg - a.avg);
}

// Display name and grouping key for deposits, whose bank descriptions vary
// ("CO: LIGHTNING RIDGE" vs "CO: LIGHTNING RIDG", changing reference numbers)
function payerName(t) {
  const raw = t.merchant_name || (t.name.includes("CO:") ? t.name.split("CO:").pop() : t.name);
  const clean = raw.replace(/["“”]/g, "").replace(/\b\d[\d/.-]*\b/g, "").replace(/\s+/g, " ").trim();
  const title = clean.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Llc|Inc|Co)\b/g, (w) => w.toUpperCase());
  return { name: title, key: clean.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12) };
}

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / DAY);

// Paychecks and other income that arrive on a steady schedule
export function recurringIncome(transactions) {
  const today = new Date().toLocaleDateString("en-CA");
  const groups = new Map();
  for (const t of transactions) {
    if (t.is_excluded || t.amount >= 0 || txCategory(t) !== "INCOME") continue;
    if (daysBetween(t.date, today) > 150 || -t.amount < 20) continue;
    const { name, key } = payerName(t);
    if (!groups.has(key)) groups.set(key, { name, txs: [] });
    groups.get(key).txs.push(t);
  }
  const out = [];
  for (const { txs } of groups.values()) {
    if (txs.length < 3) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = txs.slice(1).map((t, i) => daysBetween(txs[i].date, t.date)).filter((g) => g > 0).sort((a, b) => a - b);
    if (!gaps.length) continue;
    const median = gaps[Math.floor(gaps.length / 2)];
    const frequency = median <= 9 ? "weekly" : median <= 17 ? "biweekly" : median <= 21 ? "semimonthly" : "monthly";
    const step = { weekly: 7, biweekly: 14, semimonthly: 15, monthly: 30 }[frequency];
    const last = txs.at(-1);
    const displayName = payerName(last).name;
    // Stopped arriving (e.g. a job or benefit that ended)
    if (daysBetween(last.date, today) > Math.max(step * 1.6, step + 6)) continue;
    const recent = txs.slice(-3).map((t) => -Number(t.amount));
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    out.push({ name: displayName, avg, lastAmount: -Number(last.amount), lastDate: last.date, frequency, step, day: Number(last.date.slice(8, 10)), accountId: last.account_id, steady: Math.max(...recent) - Math.min(...recent) <= avg * 0.1 });
  }
  return out.sort((a, b) => b.avg - a.avg);
}

// Loans Plaid can't report due dates for (auto, personal): project from the last payment received
export function loanPayments(transactions, accounts, liabilities) {
  const covered = new Set(liabilities.filter((l) => l.next_payment_due_date).map((l) => l.account_id));
  const out = [];
  for (const a of accounts) {
    if (a.type !== "loan" || a.is_hidden || covered.has(a.id) || !(Number(a.current_balance) > 0)) continue;
    const payments = transactions.filter((t) => t.account_id === a.id && t.amount < 0).sort((x, y) => y.date.localeCompare(x.date));
    if (!payments.length) continue;
    const last = payments[0];
    out.push({ account: a, amount: -Number(last.amount), lastDate: last.date, day: Number(last.date.slice(8, 10)) });
  }
  return out;
}
