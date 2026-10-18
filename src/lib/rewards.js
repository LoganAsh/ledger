// Card rewards: earn rates come from each card's published terms (checked Oct 2026),
// not from the bank. Points and miles are valued at 1¢ each.

export const REWARD_CATEGORIES = {
  dining: "Dining",
  delivery: "Food delivery",
  grocery: "Groceries",
  superstore: "Walmart & Target",
  gas: "Gas",
  costco_gas: "Costco gas",
  costco: "Costco",
  wholesale: "Sam’s Club",
  travel: "Travel",
  streaming: "Streaming",
  entertainment: "Entertainment",
  utilities: "Utilities",
  home_improvement: "Home improvement",
  drugstore: "Drug stores",
  transportation: "Transportation",
  microsoft: "Microsoft & Xbox",
  other: "Everything else",
};

const NOT_PURCHASES = ["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "INCOME", "BANK_FEES"];
// Payments that generally can't go on a credit card without a fee
const NOT_CARD_PAYABLE = ["RENT_AND_UTILITIES_RENT", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"];
export const isPurchase = (t) =>
  t.amount > 0 && !NOT_PURCHASES.includes(t.category_primary) && !NOT_CARD_PAYABLE.includes(t.category_detailed);

// Peer-to-peer wallets (Venmo, PayPal, Cash App): payments there are to people, not card purchases
const P2P = /venmo|paypal|cash ?app|zelle/i;
export const p2pAccountIds = (items, accounts) => {
  const itemIds = new Set(items.filter((i) => P2P.test(i.institution_name ?? "")).map((i) => i.id));
  return new Set(accounts.filter((a) => itemIds.has(a.item_id) || P2P.test(a.name)).map((a) => a.id));
};

export function rewardCategory(t) {
  const m = `${t.merchant_name ?? ""} ${t.name ?? ""}`.toLowerCase();
  const d = t.category_detailed ?? "";
  const p = t.category_primary ?? "";
  if (/microsoft|xbox/.test(m)) return "microsoft";
  if (/costco/.test(m)) return /gas|fuel/.test(m) || d === "TRANSPORTATION_GAS" ? "costco_gas" : "costco";
  // Warehouse-club fuel stations (e.g. "SAMS FUEL") are coded as gas stations by card issuers
  if (/\bfuel\b/.test(m)) return "gas";
  if (/sam'?s club|bj'?s wholesale|\bbjs\b/.test(m)) return "wholesale";
  if (/doordash|grubhub|uber ?eats|postmates/.test(m)) return "delivery";
  if (/netflix|disney|hulu|spotify|\bmax\b|hbo|peacock|paramount|youtube ?tv|apple ?tv|prime video|sling|fubo/.test(m)) return "streaming";
  if (d === "TRANSPORTATION_GAS") return "gas";
  if (d.startsWith("FOOD_AND_DRINK_GROCER")) return /walmart|target/.test(m) ? "superstore" : "grocery";
  if (/walmart|target/.test(m)) return "superstore";
  if (p === "FOOD_AND_DRINK" && !/BEER_WINE|VENDING/.test(d)) return "dining";
  if (p === "TRAVEL") return "travel";
  if (p === "ENTERTAINMENT") return d === "ENTERTAINMENT_TV_AND_MOVIES" ? "streaming" : d === "ENTERTAINMENT_CASINOS_AND_GAMBLING" ? "other" : "entertainment";
  if (p === "RENT_AND_UTILITIES" && d !== "RENT_AND_UTILITIES_RENT") return "utilities";
  if (p === "HOME_IMPROVEMENT") return "home_improvement";
  if (d === "MEDICAL_PHARMACIES_AND_SUPPLEMENTS") return "drugstore";
  if (p === "TRANSPORTATION") return "transportation";
  return "other";
}

export const quarterOf = (iso) => `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

// Discover it rotating 5% categories (activation required, $1,500 per quarter)
export const DISCOVER_QUARTERS = {
  "2026-Q1": ["grocery", "wholesale", "streaming"],
  "2026-Q2": ["dining", "home_improvement"],
  "2026-Q3": ["gas", "transportation", "drugstore"],
  "2026-Q4": ["dining", "entertainment", "utilities"],
};

// Each card: base rate, category rates, and optional caps { key(date), limit, categories, after }
export const CARD_PROGRAMS = [
  {
    id: "savor", match: /savor/i, name: "Capital One Savor", currency: "cash back",
    base: 1, rates: { dining: 3, delivery: 3, grocery: 3, entertainment: 3, streaming: 3 },
    notes: ["3% dining, groceries (not Walmart/Target), entertainment and streaming", "8% Capital One Entertainment, 5% hotels and rental cars through Capital One Travel"],
  },
  {
    id: "ventureone", match: /ventureone/i, name: "Capital One VentureOne", currency: "miles",
    base: 1.25, rates: {},
    notes: ["1.25 miles per dollar on everything", "5 miles on hotels and rental cars through Capital One Travel"],
  },
  {
    id: "quicksilver", match: /quicksilver/i, name: "Capital One Quicksilver", currency: "cash back",
    base: 1.5, rates: {},
    notes: ["1.5% on everything", "5% on hotels and rental cars through Capital One Travel"],
  },
  {
    id: "costco", match: /costco/i, name: "Costco Anywhere Visa", currency: "cash back",
    base: 1, rates: { costco_gas: 5, gas: 4, dining: 3, delivery: 3, travel: 3, costco: 2 },
    caps: [{ key: (iso) => iso.slice(0, 4), limit: 7000, categories: ["costco_gas", "gas"], after: 1, label: "gas and EV charging, per year" }],
    notes: ["5% Costco gas, 4% other gas and EV charging (first $7,000 a year combined)", "3% restaurants and travel, 2% Costco, 1% everything else", "Paid once a year as a certificate with your February statement"],
  },
  {
    id: "discover", match: /discover/i, name: "Discover it", currency: "cash back",
    base: 1, rates: {},
    rotating: (iso) => DISCOVER_QUARTERS[quarterOf(iso)] ?? [],
    caps: [{ key: quarterOf, limit: 1500, rotating: true, after: 1, label: "5% categories, per quarter" }],
    notes: ["5% on rotating categories, up to $1,500 a quarter (activate each quarter)", "1% everything else"],
  },
  {
    id: "xbox", match: /xbox/i, name: "Xbox Mastercard", currency: "points",
    base: 1, rates: { microsoft: 5, streaming: 3, delivery: 3 },
    notes: ["5 points per dollar at the Microsoft Store", "3 points on streaming and food delivery, 1 point everything else", "Points redeem for Xbox gift cards (100 points = $1)"],
  },
];

export const programFor = (account) =>
  account.type === "credit" ? CARD_PROGRAMS.find((p) => p.match.test(account.official_name || account.name)) ?? null : null;

// Rate before caps
function rawRate(program, cat, iso) {
  if (!program) return 0;
  if (program.rotating && program.rotating(iso).includes(cat)) return 5;
  return program.rates[cat] ?? program.base;
}

// Applies caps in date order; returns per-transaction earnings and cap usage
export function computeRewards(transactions, accounts, sinceIso, skipAccounts = new Set()) {
  const programs = new Map(accounts.map((a) => [a.id, programFor(a)]));
  const usage = new Map(); // `${accountId}|${capIdx}|${periodKey}` -> spend
  const rows = [];
  const txs = transactions.filter((t) => t.date >= sinceIso && isPurchase(t)).sort((a, b) => a.date.localeCompare(b.date));
  for (const t of txs) {
    const account = accounts.find((a) => a.id === t.account_id);
    if (!account || (account.type !== "credit" && account.type !== "depository") || skipAccounts.has(account.id)) continue;
    const program = programs.get(t.account_id);
    const cat = rewardCategory(t);
    let rate = rawRate(program, cat, t.date);
    let earned = (t.amount * rate) / 100;
    for (const [i, cap] of (program?.caps ?? []).entries()) {
      const applies = cap.rotating ? program.rotating(t.date).includes(cat) : cap.categories.includes(cat);
      if (!applies) continue;
      const k = `${t.account_id}|${i}|${cap.key(t.date)}`;
      const used = usage.get(k) ?? 0;
      const within = Math.max(0, Math.min(t.amount, cap.limit - used));
      usage.set(k, used + t.amount);
      earned = (within * rate + (t.amount - within) * cap.after) / 100;
      rate = (earned / t.amount) * 100;
    }
    rows.push({ t, account, program, cat, rate, earned });
  }
  return { rows, usage };
}

// Best card for a category today, accounting for caps already used
export function bestCards(accounts, usage, iso) {
  const cards = accounts.filter((a) => !a.is_hidden && programFor(a));
  const out = {};
  for (const cat of Object.keys(REWARD_CATEGORIES)) {
    let best = null;
    for (const a of cards) {
      const p = programFor(a);
      let rate = rawRate(p, cat, iso);
      let capNote = null;
      for (const [i, cap] of (p.caps ?? []).entries()) {
        const applies = cap.rotating ? p.rotating(iso).includes(cat) : cap.categories.includes(cat);
        if (!applies) continue;
        const left = cap.limit - (usage.get(`${a.id}|${i}|${cap.key(iso)}`) ?? 0);
        if (left <= 0) rate = cap.after;
        else capNote = `$${Math.round(left).toLocaleString()} left at this rate`;
      }
      // Prefer cash/points cards over the duplicate of the same program
      if (!best || rate > best.rate) best = { account: a, program: p, rate, capNote };
    }
    out[cat] = best;
  }
  return out;
}

export const bestRateFor = (best, cat) => best[cat]?.rate ?? 0;

export const DISCOVER_QUARTER_LABELS = {
  "2026-Q1": "Grocery stores, wholesale clubs and streaming",
  "2026-Q2": "Restaurants and home improvement stores",
  "2026-Q3": "Gas stations, transportation and drug stores",
  "2026-Q4": "Restaurants, entertainment and utilities",
};

// Discover earnings split by quarter: 5% bonus spend against the $1,500 cap, plus 1% on the rest
export function discoverQuarters(rows, accountIds, year) {
  const out = ["Q1", "Q2", "Q3", "Q4"].map((q) => ({
    key: `${year}-${q}`, label: q, categories: DISCOVER_QUARTER_LABELS[`${year}-${q}`] ?? "Not announced yet",
    bonusSpend: 0, otherSpend: 0, bonusEarned: 0, otherEarned: 0,
  }));
  for (const r of rows) {
    if (!accountIds.includes(r.account.id)) continue;
    const q = out.find((o) => o.key === quarterOf(r.t.date));
    if (!q) continue;
    if ((DISCOVER_QUARTERS[q.key] ?? []).includes(r.cat)) { q.bonusSpend += r.t.amount; q.bonusEarned += r.earned; }
    else { q.otherSpend += r.t.amount; q.otherEarned += r.earned; }
  }
  return out;
}
