import { createClient } from "npm:@supabase/supabase-js@2.45.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const PLAID_BASE = Deno.env.get("PLAID_ENV") === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";

export class PlaidError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

// deno-lint-ignore no-explicit-any
export async function plaid(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: Deno.env.get("PLAID_CLIENT_ID"), secret: Deno.env.get("PLAID_SECRET"), ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new PlaidError(data.error_code ?? "UNKNOWN", data.error_message ?? "Plaid request failed", res.status);
  return data;
}

export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

export async function getUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

export async function getToken(itemId: string): Promise<string> {
  const { data, error } = await admin.rpc("get_plaid_token", { p_item_id: itemId });
  if (error || !data) throw new Error("Access token not found for this bank");
  return data as string;
}
