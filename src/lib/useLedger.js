import { useCallback, useEffect, useState } from "react";
import { callFunction, fetchAll, supabase } from "./supabase";

const HISTORY_MONTHS = 15;

export function useLedger(session) {
  const [state, setState] = useState({
    loading: true, error: null, accounts: [], items: [], transactions: [], snapshots: [], budgets: [], bills: [], hiddenRecurring: [], liabilities: [], assets: [],
  });
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const since = new Date();
      since.setMonth(since.getMonth() - HISTORY_MONTHS);
      const sinceIso = since.toISOString().slice(0, 10);

      const rows = (r) => { if (r.error) throw r.error; return r.data; };
      const [accounts, items, budgets, transactions, snapshots, bills, hidden, liabilities, assets] = await Promise.all([
        supabase.from("accounts").select("*").order("type").order("name").then((r) => { if (r.error) throw r.error; return r.data; }),
        supabase.from("plaid_items").select("id, institution_name, status, liabilities_status, last_error, last_synced_at, created_at").order("created_at").then((r) => { if (r.error) throw r.error; return r.data; }),
        supabase.from("budgets").select("*").order("category").then((r) => { if (r.error) throw r.error; return r.data; }),
        fetchAll(() => supabase.from("transactions").select("*").gte("date", sinceIso).order("date", { ascending: false }).order("id")),
        fetchAll(() => supabase.from("balance_snapshots").select("account_id, snapshot_date, current_balance").gte("snapshot_date", sinceIso).order("snapshot_date").order("id")),
        supabase.from("bills").select("*").order("next_due").then(rows),
        supabase.from("recurring_hidden").select("id, merchant").then(rows),
        supabase.from("liabilities").select("*").then(rows),
        supabase.from("assets").select("*").order("created_at").then(rows),
      ]);
      setState({ loading: false, error: null, accounts, items, transactions, snapshots, budgets, bills, hiddenRecurring: hidden, liabilities, assets });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  const sync = useCallback(async (itemId) => {
    setSyncing(true);
    try {
      const res = await callFunction("plaid-sync", itemId ? { item_id: itemId } : {});
      await load();
      return res;
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const updateTransaction = useCallback(async (id, patch) => {
    const { error } = await supabase.from("transactions").update(patch).eq("id", id);
    if (error) throw error;
    setState((s) => ({ ...s, transactions: s.transactions.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }, []);

  const updateAccount = useCallback(async (id, patch) => {
    const { error } = await supabase.from("accounts").update(patch).eq("id", id);
    if (error) throw error;
    setState((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }, []);

  const saveBudget = useCallback(async (category, monthly_limit) => {
    const { data, error } = await supabase
      .from("budgets")
      .upsert({ user_id: session.user.id, category, monthly_limit }, { onConflict: "user_id,category" })
      .select()
      .single();
    if (error) throw error;
    setState((s) => ({ ...s, budgets: [...s.budgets.filter((b) => b.category !== category), data] }));
  }, [session]);

  const deleteBudget = useCallback(async (id) => {
    const { error } = await supabase.from("budgets").delete().eq("id", id);
    if (error) throw error;
    setState((s) => ({ ...s, budgets: s.budgets.filter((b) => b.id !== id) }));
  }, []);

  const saveBill = useCallback(async (bill) => {
    const { id, ...fields } = bill;
    const query = id
      ? supabase.from("bills").update(fields).eq("id", id)
      : supabase.from("bills").insert({ ...fields, user_id: session.user.id });
    const { data, error } = await query.select().single();
    if (error) throw error;
    setState((s) => ({ ...s, bills: [...s.bills.filter((b) => b.id !== data.id), data] }));
  }, [session]);

  const deleteBill = useCallback(async (id) => {
    const { error } = await supabase.from("bills").delete().eq("id", id);
    if (error) throw error;
    setState((s) => ({ ...s, bills: s.bills.filter((b) => b.id !== id) }));
  }, []);

  const hideRecurring = useCallback(async (merchant) => {
    const { data, error } = await supabase
      .from("recurring_hidden")
      .upsert({ user_id: session.user.id, merchant }, { onConflict: "user_id,merchant" })
      .select("id, merchant")
      .single();
    if (error) throw error;
    setState((s) => ({ ...s, hiddenRecurring: [...s.hiddenRecurring.filter((h) => h.merchant !== merchant), data] }));
  }, [session]);

  const unhideRecurring = useCallback(async (id) => {
    const { error } = await supabase.from("recurring_hidden").delete().eq("id", id);
    if (error) throw error;
    setState((s) => ({ ...s, hiddenRecurring: s.hiddenRecurring.filter((h) => h.id !== id) }));
  }, []);

  const saveAsset = useCallback(async (asset) => {
    const { id, ...fields } = asset;
    const query = id
      ? supabase.from("assets").update(fields).eq("id", id)
      : supabase.from("assets").insert({ ...fields, user_id: session.user.id });
    const { data, error } = await query.select().single();
    if (error) throw error;
    setState((s) => ({ ...s, assets: [...s.assets.filter((a) => a.id !== data.id), data] }));
  }, [session]);

  const deleteAsset = useCallback(async (id) => {
    const { error } = await supabase.from("assets").delete().eq("id", id);
    if (error) throw error;
    setState((s) => ({ ...s, assets: s.assets.filter((a) => a.id !== id) }));
  }, []);

  return {
    ...state, syncing, saveAsset, deleteAsset, reload: load, sync, updateTransaction, updateAccount, saveBudget, deleteBudget,
    saveBill, deleteBill, hideRecurring, unhideRecurring,
  };
}
