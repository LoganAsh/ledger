import { useCallback, useEffect, useState } from "react";
import { callFunction, fetchAll, supabase } from "./supabase";

const HISTORY_MONTHS = 15;

export function useLedger(session) {
  const [state, setState] = useState({ loading: true, error: null, accounts: [], items: [], transactions: [], snapshots: [], budgets: [] });
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const since = new Date();
      since.setMonth(since.getMonth() - HISTORY_MONTHS);
      const sinceIso = since.toISOString().slice(0, 10);

      const [accounts, items, budgets, transactions, snapshots] = await Promise.all([
        supabase.from("accounts").select("*").order("type").order("name").then((r) => { if (r.error) throw r.error; return r.data; }),
        supabase.from("plaid_items").select("id, institution_name, status, last_error, last_synced_at, created_at").order("created_at").then((r) => { if (r.error) throw r.error; return r.data; }),
        supabase.from("budgets").select("*").order("category").then((r) => { if (r.error) throw r.error; return r.data; }),
        fetchAll(() => supabase.from("transactions").select("*").gte("date", sinceIso).order("date", { ascending: false }).order("id")),
        fetchAll(() => supabase.from("balance_snapshots").select("account_id, snapshot_date, current_balance").gte("snapshot_date", sinceIso).order("snapshot_date").order("id")),
      ]);
      setState({ loading: false, error: null, accounts, items, transactions, snapshots, budgets });
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

  return { ...state, syncing, reload: load, sync, updateTransaction, updateAccount, saveBudget, deleteBudget };
}
