import { admin, cors, getToken, getUser, json, plaid, PlaidError } from "./plaid.ts";

// Creates a Plaid Link token.
//   {}                              -> link a new bank
//   { item_id }                     -> sign back in to an existing bank (update mode)
//   { item_id, consent: true }      -> also ask the bank to share card/loan due dates
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const user = await getUser(req);
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { item_id, consent } = await req.json().catch(() => ({}));
  const body: Record<string, unknown> = {
    user: { client_user_id: user.id },
    client_name: "LEDGER",
    country_codes: ["US"],
    language: "en",
  };

  try {
    if (item_id) {
      const { data: item } = await admin.from("plaid_items").select("id").eq("id", item_id).eq("user_id", user.id).maybeSingle();
      if (!item) return json({ error: "Linked bank not found" }, 404);
      body.access_token = await getToken(item.id);
      if (consent) body.additional_consented_products = ["liabilities"];
    } else {
      body.products = ["transactions"];
      body.optional_products = ["liabilities"];
      body.transactions = { days_requested: 730 };
    }
    const { link_token, expiration } = await plaid("/link/token/create", body);
    return json({ link_token, expiration });
  } catch (e) {
    const code = e instanceof PlaidError ? e.code : "SERVER_ERROR";
    return json({ error: (e as Error).message, code }, 400);
  }
});
