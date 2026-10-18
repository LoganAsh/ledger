import { useMemo, useState } from "react";
import { dateLabel, money, moneyWhole } from "../lib/format";
import { REWARD_CATEGORIES, bestCards, computeRewards, programFor } from "../lib/rewards";

const pct = (r) => `${parseFloat(r.toFixed(2))}%`;
const cardLabel = (a) => `${a.nickname || programFor(a)?.name || a.name}${a.mask ? ` ••${a.mask}` : ""}`;

export default function Rewards({ ledger, go }) {
  const { transactions, accounts } = ledger;
  const today = new Date().toLocaleDateString("en-CA");
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const [openCard, setOpenCard] = useState(null);

  const data = useMemo(() => {
    const { rows, usage } = computeRewards(transactions, accounts, yearStart);
    const best = bestCards(accounts, usage, today);
    const cards = accounts.filter((a) => a.type === "credit" && !a.is_hidden);
    const programs = cards.map(programFor).filter(Boolean);

    // Best uncapped rate across your cards on a given date and category
    const bestOn = (cat, iso) => Math.max(0, ...programs.map((p) => (p.rotating?.(iso).includes(cat) ? 5 : p.rates[cat] ?? p.base)));

    let earned = 0, missed = 0;
    const byCard = new Map();
    const byCat = new Map();
    const misses = [];
    for (const r of rows) {
      earned += r.earned;
      const key = r.account.type === "credit" ? r.account.id : "debit";
      const c = byCard.get(key) ?? { account: r.account, spend: 0, earned: 0 };
      c.spend += r.t.amount;
      c.earned += r.earned;
      byCard.set(key, c);
      byCat.set(r.cat, (byCat.get(r.cat) ?? 0) + r.t.amount);
      const gap = ((bestOn(r.cat, r.t.date) - r.rate) * r.t.amount) / 100;
      if (gap > 0.005) {
        missed += gap;
        misses.push({ ...r, gap });
      }
    }
    const monthsElapsed = Math.max(1, Number(today.slice(5, 7)) - 1 + Number(today.slice(8, 10)) / 31);
    return { earned, missed, best, byCard, byCat, misses: misses.sort((a, b) => b.gap - a.gap).slice(0, 6), monthsElapsed, cards };
  }, [transactions, accounts, yearStart, today]);

  const debit = data.byCard.get("debit");
  const hasDiscover = data.cards.some((a) => programFor(a)?.id === "discover");
  const unknownCards = data.cards.filter((a) => !programFor(a));
  const catsBySpend = Object.keys(REWARD_CATEGORIES)
    .filter((c) => data.best[c] && (data.byCat.get(c) || ["dining", "grocery", "gas", "travel", "streaming"].includes(c)))
    .sort((a, b) => (data.byCat.get(b) ?? 0) - (data.byCat.get(a) ?? 0));

  return (
    <>
      <header className="page-head">
        <div>
          <button className="btn-text back" onClick={() => go("accounts")}>‹ Accounts</button>
          <h1 className="page-title">Card rewards</h1>
        </div>
      </header>

      <section className="cover">
        <p className="strip-label">Estimated rewards earned in {today.slice(0, 4)}</p>
        <p className="figure-lg pos">{money(data.earned)}</p>
        {data.missed >= 1 && (
          <p className="meta">Using the best card for each purchase would have earned about <strong>{moneyWhole(data.missed)}</strong> more.</p>
        )}
      </section>

      {hasDiscover && (
        <div className="attention">
          <span>Discover’s 5% categories this quarter are restaurants, entertainment and utilities. They only count if you activate them with Discover.</span>
        </div>
      )}

      <section className="block">
        <div className="block-head static"><h2>Which card to use</h2></div>
        <ul className="plain-list">
          {catsBySpend.map((c) => {
            const b = data.best[c];
            const monthly = (data.byCat.get(c) ?? 0) / data.monthsElapsed;
            return (
              <li key={c}>
                <span>
                  {REWARD_CATEGORIES[c]}
                  <span className="tx-sub"> {cardLabel(b.account)}{b.capNote ? `, ${b.capNote}` : ""}{monthly >= 1 ? ` · you spend ~${moneyWhole(monthly)}/mo` : ""}</span>
                </span>
                <span className="num pos">{pct(b.rate)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="block">
        <div className="block-head static"><h2>By card this year</h2></div>
        <ul className="acct-list">
          {data.cards.map((a) => {
            const c = data.byCard.get(a.id);
            const p = programFor(a);
            const open = openCard === a.id;
            return (
              <li key={a.id}>
                <button className="acct" onClick={() => setOpenCard(open ? null : a.id)} aria-expanded={open}>
                  <div className="tx-main">
                    <span className="tx-name">{cardLabel(a)}</span>
                    <span className="tx-sub">
                      {c ? `${money(c.spend)} spent · ${pct((c.earned / c.spend) * 100)} average` : "No purchases this year"}
                    </span>
                  </div>
                  <div className="acct-right">
                    <span className="num pos">{money(c?.earned ?? 0)}</span>
                    <span className="tx-sub">{p ? p.currency : "no program found"}</span>
                  </div>
                </button>
                {open && (
                  <ul className="card-notes">
                    {(p?.notes ?? ["No rewards program found for this card. Let Claude know if it earns rewards."]).map((n) => <li key={n}>{n}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
          {debit && (
            <li>
              <div className="acct">
                <div className="tx-main">
                  <span className="tx-name">Debit card purchases</span>
                  <span className="tx-sub">{money(debit.spend)} spent from checking</span>
                </div>
                <div className="acct-right"><span className="num">$0.00</span><span className="tx-sub">no rewards</span></div>
              </div>
            </li>
          )}
        </ul>
      </section>

      {data.misses.length > 0 && (
        <section className="block">
          <div className="block-head static"><h2>Biggest missed rewards</h2></div>
          <ul className="tx-list">
            {data.misses.map((m) => (
              <li key={m.t.id} className="tx">
                <div className="tx-main">
                  <span className="tx-name">{m.t.merchant_name || m.t.name}</span>
                  <span className="tx-sub">
                    {dateLabel(m.t.date)} · {money(m.t.amount)} on {m.account.type === "credit" ? cardLabel(m.account) : "debit"} · {REWARD_CATEGORIES[m.cat]}
                  </span>
                </div>
                <span className="tx-amt neg">−{money(m.gap)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="meta fine">
        Estimates use each card’s published earn rates and your bank’s merchant categories, which don’t always match how the card issuer codes a purchase.
        Capital One Travel and Entertainment portal bonuses aren’t counted. Points and miles are valued at 1¢.
        {unknownCards.length ? ` No rewards program found for ${unknownCards.map(cardLabel).join(", ")}.` : ""}
        {" "}Cards you haven’t linked aren’t included.
      </p>
    </>
  );
}

