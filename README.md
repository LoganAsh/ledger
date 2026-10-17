# Ledger

Private personal finance dashboard: every checking, savings, credit and loan account in one place, with net worth tracking and spending analysis. Installs on a phone as a PWA.

## Stack
- **Frontend:** React 18 + Vite, PWA via `vite-plugin-pwa`, hosted on Vercel
- **Backend:** Supabase project `personal-finance` (`mnhncbvwxjscjjvyodgx`)
  - Postgres with row-level security on every table
  - Edge Functions: `plaid-link-token`, `plaid-exchange`, `plaid-sync`
  - Daily `pg_cron` job calls `plaid-sync` at 12:00 UTC
- **Bank data:** Plaid (Transactions product)

## Environment variables
Committed in `.env.production` (both are browser-safe). Vercel env vars with the same names override them.

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://mnhncbvwxjscjjvyodgx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (safe for the browser) |

Plaid credentials (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`) live only in Supabase Edge Function secrets, never in this repo.

## Security model
- Bank access tokens are stored in a `private` schema the API cannot reach; only Edge Functions read them.
- The app can read its owner's rows and edit only nicknames, hidden flags, categories, notes and budgets.
- Balances and transactions are written only by the sync function.

## Local development
```
cp .env.example .env.local   # fill in the publishable key
npm install
npm run dev
```

## Install on iPhone
Open the site in Safari, tap Share, then **Add to Home Screen**.
