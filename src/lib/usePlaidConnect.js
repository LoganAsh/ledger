import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { callFunction } from "./supabase";

// Opens Plaid Link to add a bank, or to sign back in to one (pass its item id)
export function usePlaidConnect({ onLinked }) {
  const [token, setToken] = useState(null);
  const [itemId, setItemId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  const reset = () => { setToken(null); setItemId(null); setBusy(false); };

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, metadata) => {
      try {
        if (itemId) {
          await callFunction("plaid-sync", { item_id: itemId });
          setMessage(`${metadata?.institution?.name ?? "Bank"} reconnected.`);
        } else {
          const res = await callFunction("plaid-exchange", { public_token: publicToken });
          const name = res.institution_name ?? metadata?.institution?.name ?? "Bank";
          setMessage(
            res.sync?.added > 0
              ? `${name} linked. ${res.sync.added} transactions imported.`
              : `${name} linked. Transaction history can take a few minutes to arrive; tap Refresh shortly.`,
          );
        }
        await onLinked?.();
      } catch (e) {
        setError(e.message);
      } finally {
        reset();
      }
    },
    onExit: (err) => {
      if (err?.display_message || err?.error_message) setError(err.display_message || err.error_message);
      reset();
    },
  });

  useEffect(() => { if (token && ready) open(); }, [token, ready, open]);

  const start = useCallback(async (reconnectItemId = null) => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { link_token } = await callFunction("plaid-link-token", reconnectItemId ? { item_id: reconnectItemId } : {});
      setItemId(reconnectItemId);
      setToken(link_token);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }, []);

  return { start, busy, error, message, clearMessage: () => { setMessage(null); setError(null); } };
}
