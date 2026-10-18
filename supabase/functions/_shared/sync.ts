import { admin, getToken, plaid, PlaidError } from "./plaid.ts";

export type Item = { id: string; user_id: string; transactions_cursor: string | null };

const LOGIN_CODES = ["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT"];
const NOT_SUPPORTED_CODES = ["PRODUCTS_NOT_SUPPORTED", "NO_LIABILITY_ACCOUNTS", "PRODUCT_NOT_READY"];

async function upsertAccounts(item: Item, token: string) {
  const { accounts } = await plaid("/accounts/get", { access_token: token });
  // deno-lint-ignore no-explicit-any
  const rows = accounts.map((a: any) => ({
    user_id: item.user_id,
    item_id: item.id,
    plaid_account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    current_balance: a.balances?.current,
    available_balance: a.balances?.available,
    credit_limit: a.balances?.limit,
    iso_currency_code: a.balances?.iso_currency_code ?? "USD",
  }));
  const { data, error } = await admin
    .from("accounts")
    .upsert(rows, { onConflict: "plaid_account_id" })
    .select("id, plaid_account_id, type, current_balance, available_balance");
  if (error) throw error;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  const snaps = data.map((a) => ({
    user_id: item.user_id,
    account_id: a.id,
    snapshot_date: today,
    current_balance: a.current_balance,
    available_balance: a.available_balance,
  }));
  const { error: snapErr } = await admin.from("balance_snapshots").upsert(snaps, { onConflict: "account_id,snapshot_date" });
  if (snapErr) throw snapErr;

  return {
    accountMap: new Map<string, string>(data.map((a) => [a.plaid_account_id, a.id])),
    hasDebt: data.some((a) => a.type === "credit" || a.type === "loan"),
  };
}

async function syncTransactions(item: Item, token: string, accountMap: Map<string, string>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let cursor = item.transactions_cursor ?? undefined;
    // deno-lint-ignore no-explicit-any
    const added: any[] = [], modified: any[] = [], removed: any[] = [];
    try {
      let hasMore = true;
      while (hasMore) {
        const page = await plaid("/transactions/sync", { access_token: token, cursor, count: 500 });
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed);
        cursor = page.next_cursor;
        hasMore = page.has_more;
      }
    } catch (e) {
      // Plaid's data changed mid-pagination: restart from the saved cursor
      if (e instanceof PlaidError && e.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") continue;
      throw e;
    }

    const rows = [...added, ...modified]
      .filter((t) => accountMap.has(t.account_id))
      .map((t) => ({
        user_id: item.user_id,
        account_id: accountMap.get(t.account_id),
        plaid_transaction_id: t.transaction_id,
        amount: t.amount,
        iso_currency_code: t.iso_currency_code ?? "USD",
        date: t.date,
        authorized_date: t.authorized_date,
        name: t.name ?? t.merchant_name ?? "Transaction",
        merchant_name: t.merchant_name,
        logo_url: t.logo_url ?? t.counterparties?.[0]?.logo_url ?? null,
        category_primary: t.personal_finance_category?.primary ?? null,
        category_detailed: t.personal_finance_category?.detailed ?? null,
        payment_channel: t.payment_channel,
        pending: t.pending,
      }));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("transactions").upsert(rows.slice(i, i + 500), { onConflict: "plaid_transaction_id" });
      if (error) throw error;
    }
    if (removed.length) {
      const ids = removed.map((r) => r.transaction_id);
      for (let i = 0; i < ids.length; i += 500) {
        const { error } = await admin.from("transactions").delete().in("plaid_transaction_id", ids.slice(i, i + 500));
        if (error) throw error;
      }
    }

    const { error: curErr } = await admin.from("plaid_items").update({ transactions_cursor: cursor }).eq("id", item.id);
    if (curErr) throw curErr;
    return { added: added.length, modified: modified.length, removed: removed.length };
  }
  throw new Error("Bank data kept changing during sync; try again in a few minutes.");
}

// Card and loan due dates. Never fails the overall sync.
async function syncLiabilities(item: Item, token: string, accountMap: Map<string, string>, hasDebt: boolean) {
  if (!hasDebt) {
    await admin.from("plaid_items").update({ liabilities_status: "not_supported" }).eq("id", item.id);
    return "not_supported";
  }
  try {
    const { liabilities } = await plaid("/liabilities/get", { access_token: token });
    const base = (accountId: string) => ({ account_id: accountMap.get(accountId), user_id: item.user_id });
    // deno-lint-ignore no-explicit-any
    const rows: any[] = [];
    for (const c of liabilities?.credit ?? []) {
      rows.push({
        ...base(c.account_id), kind: "credit",
        next_payment_due_date: c.next_payment_due_date, minimum_payment_amount: c.minimum_payment_amount,
        last_statement_balance: c.last_statement_balance, last_statement_issue_date: c.last_statement_issue_date,
        last_payment_amount: c.last_payment_amount, last_payment_date: c.last_payment_date, is_overdue: c.is_overdue,
      });
    }
    for (const s of liabilities?.student ?? []) {
      rows.push({
        ...base(s.account_id), kind: "student",
        next_payment_due_date: s.next_payment_due_date, minimum_payment_amount: s.minimum_payment_amount,
        last_statement_balance: s.last_statement_balance, last_statement_issue_date: s.last_statement_issue_date,
        last_payment_amount: s.last_payment_amount, last_payment_date: s.last_payment_date, is_overdue: s.is_overdue,
      });
    }
    for (const m of liabilities?.mortgage ?? []) {
      rows.push({
        ...base(m.account_id), kind: "mortgage",
        next_payment_due_date: m.next_payment_due_date, minimum_payment_amount: m.next_monthly_payment,
        last_statement_balance: null, last_statement_issue_date: null,
        last_payment_amount: m.last_payment_amount, last_payment_date: m.last_payment_date,
        is_overdue: (m.past_due_amount ?? 0) > 0,
      });
    }
    const valid = rows.filter((r) => r.account_id);
    if (valid.length) {
      const { error } = await admin.from("liabilities").upsert(valid, { onConflict: "account_id" });
      if (error) throw error;
    }
    await admin.from("plaid_items").update({ liabilities_status: "active" }).eq("id", item.id);
    return "active";
  } catch (e) {
    const code = e instanceof PlaidError ? e.code : "";
    const status = code === "ADDITIONAL_CONSENT_REQUIRED" ? "consent_required" : NOT_SUPPORTED_CODES.includes(code) ? "not_supported" : null;
    if (status) await admin.from("plaid_items").update({ liabilities_status: status }).eq("id", item.id);
    else console.error("liabilities sync failed", item.id, (e as Error).message);
    return status ?? "error";
  }
}

export async function syncItem(item: Item) {
  try {
    const token = await getToken(item.id);
    const { accountMap, hasDebt } = await upsertAccounts(item, token);
    // Joint accounts already linked through another login at this bank: skip their copies
    await admin.rpc("mark_duplicate_accounts", { p_user: item.user_id });
    const { data: dups } = await admin.from("accounts").select("plaid_account_id").eq("item_id", item.id).not("duplicate_of", "is", null);
    for (const d of dups ?? []) accountMap.delete(d.plaid_account_id);
    const counts = await syncTransactions(item, token, accountMap);
    const liabilities = await syncLiabilities(item, token, accountMap, hasDebt);
    await admin
      .from("plaid_items")
      .update({ status: "active", last_error: null, last_synced_at: new Date().toISOString() })
      .eq("id", item.id);
    return { item_id: item.id, ok: true, liabilities, ...counts };
  } catch (e) {
    const code = e instanceof PlaidError ? e.code : "SERVER_ERROR";
    const status = LOGIN_CODES.includes(code) ? "login_required" : "error";
    await admin.from("plaid_items").update({ status, last_error: (e as Error).message }).eq("id", item.id);
    return { item_id: item.id, ok: false, code, error: (e as Error).message };
  }
}
