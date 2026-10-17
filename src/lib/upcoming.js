import { loanPayments, recurringCharges, recurringIncome } from "./finance";

// Date helpers on plain YYYY-MM-DD strings (local calendar days, no time zones)
export const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromIso = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
export const todayIso = () => toIso(new Date());
export const addDays = (iso, n) => { const d = fromIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const monthDate = (y, m, day) => toIso(new Date(y, m, Math.min(day, daysIn(y, m))));

export const FREQUENCIES = [
  { id: "monthly", label: "Monthly" },
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "quarterly", label: "Every 3 months" },
  { id: "yearly", label: "Yearly" },
  { id: "once", label: "One time" },
];
export const frequencyLabel = (id) => FREQUENCIES.find((f) => f.id === id)?.label ?? id;

// All dates a bill falls on within [start, end]
function billDates(bill, rangeStart, end) {
  const anchor = bill.next_due;
  // Never project before the next due date the user entered
  const start = rangeStart > anchor ? rangeStart : anchor;
  if (start > end) return [];
  if (bill.frequency === "once") return anchor >= start && anchor <= end ? [anchor] : [];
  const out = [];
  if (bill.frequency === "weekly" || bill.frequency === "biweekly") {
    const step = bill.frequency === "weekly" ? 7 : 14;
    const diff = Math.floor((fromIso(start) - fromIso(anchor)) / 86400000);
    let d = addDays(anchor, Math.floor(diff / step) * step);
    while (d <= end) { if (d >= start) out.push(d); d = addDays(d, step); }
    return out;
  }
  const stepMonths = { monthly: 1, quarterly: 3, yearly: 12 }[bill.frequency];
  const a = fromIso(anchor);
  const s = fromIso(start), e = fromIso(end);
  const offsetStart = (s.getFullYear() - a.getFullYear()) * 12 + (s.getMonth() - a.getMonth());
  const offsetEnd = (e.getFullYear() - a.getFullYear()) * 12 + (e.getMonth() - a.getMonth());
  for (let k = Math.floor(offsetStart / stepMonths) * stepMonths - stepMonths; k <= offsetEnd; k += stepMonths) {
    const d = monthDate(a.getFullYear(), a.getMonth() + k, a.getDate());
    if (d >= start && d <= end) out.push(d);
  }
  return out;
}

// Builds every expected payment between start and end (inclusive)
export function buildSchedule({ bills, transactions, liabilities, accounts, hiddenRecurring }, start, end) {
  const accountName = new Map(accounts.map((a) => [a.id, a.nickname || a.name]));
  const out = [];

  for (const b of bills) {
    if (!b.is_active) continue;
    for (const date of billDates(b, start, end)) {
      out.push({
        key: `bill-${b.id}-${date}`, date, name: b.name, amount: Number(b.amount), source: "bill",
        direction: b.kind === "income" ? "in" : "out",
        autopay: b.autopay, account: accountName.get(b.account_id), bill: b,
      });
    }
  }

  const hidden = new Set(hiddenRecurring.map((h) => h.merchant));
  for (const r of recurringCharges(transactions)) {
    if (hidden.has(r.name)) continue;
    const s = fromIso(start), e = fromIso(end);
    for (let y = s.getFullYear(), m = s.getMonth(); y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth()); m === 11 ? (y++, m = 0) : m++) {
      const date = monthDate(y, m, r.day);
      // Skip months where this charge already posted
      if (date < start || date > end || date.slice(0, 7) <= r.lastDate.slice(0, 7)) continue;
      out.push({
        key: `rec-${r.name}-${date}`, date, name: r.name, amount: r.avg, source: "recurring", direction: "out",
        estimated: true, account: accountName.get(r.accountId), recurring: r,
      });
    }
  }

  for (const l of liabilities) {
    if (!l.next_payment_due_date || l.next_payment_due_date < start || l.next_payment_due_date > end) continue;
    const acct = accounts.find((a) => a.id === l.account_id);
    if (!acct || acct.is_hidden) continue;
    const isCard = l.kind === "credit";
    const statement = l.last_statement_balance != null ? Number(l.last_statement_balance) : null;
    const paid = isCard && l.last_payment_date && l.last_statement_issue_date && l.last_payment_date >= l.last_statement_issue_date
      && statement != null && Number(l.last_payment_amount ?? 0) >= statement;
    out.push({
      key: `card-${l.account_id}-${l.next_payment_due_date}`, date: l.next_payment_due_date,
      name: acct.nickname || acct.name, amount: isCard ? (statement ?? Number(l.minimum_payment_amount ?? 0)) : Number(l.minimum_payment_amount ?? 0),
      minimum: l.minimum_payment_amount != null ? Number(l.minimum_payment_amount) : null,
      source: "card", direction: "out", paid, overdue: l.is_overdue, liability: l, accountObj: acct,
    });
  }

  // Expected income: paychecks and deposits on a steady schedule
  for (const r of recurringIncome(transactions)) {
    if (hidden.has(r.name)) continue;
    for (const date of incomeDates(r, start, end)) {
      out.push({
        key: `inc-${r.name}-${date}`, date, name: r.name, amount: r.avg, source: "income", direction: "in",
        estimated: true, account: accountName.get(r.accountId), income: r,
      });
    }
  }

  // Auto and personal loans: same day each month as the last payment
  for (const lp of loanPayments(transactions, accounts, liabilities)) {
    const name = lp.account.nickname || lp.account.name;
    if (hidden.has(name)) continue;
    const s = fromIso(start), e = fromIso(end);
    for (let y = s.getFullYear(), m = s.getMonth(); y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth()); m === 11 ? (y++, m = 0) : m++) {
      const date = monthDate(y, m, lp.day);
      if (date < start || date > end || date.slice(0, 7) <= lp.lastDate.slice(0, 7)) continue;
      out.push({
        key: `loan-${lp.account.id}-${date}`, date, name, amount: lp.amount, source: "loan", direction: "out",
        estimated: true, loan: lp, accountObj: lp.account,
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}

function incomeDates(r, start, end) {
  const out = [];
  if (r.frequency === "monthly") {
    const s = fromIso(start), e = fromIso(end);
    for (let y = s.getFullYear(), m = s.getMonth(); y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth()); m === 11 ? (y++, m = 0) : m++) {
      const d = monthDate(y, m, r.day);
      if (d > r.lastDate && d >= start && d <= end) out.push(d);
    }
    return out;
  }
  let d = addDays(r.lastDate, r.step);
  while (d <= end) { if (d >= start) out.push(d); d = addDays(d, r.step); }
  return out;
}
