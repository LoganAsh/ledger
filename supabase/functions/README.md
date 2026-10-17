Edge Function sources. `_shared/plaid.ts` and `_shared/sync.ts` are bundled next to each function's
`index.ts` when deployed (imported as `./plaid.ts` and `./sync.ts`).
- plaid-link-token: link a bank, sign back in, or grant card due-date consent
- plaid-exchange: finish linking and run the first sync
- plaid-sync: balances, transactions, card/loan due dates (daily cron + Refresh button)
