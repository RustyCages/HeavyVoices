// Admin ändrar namn, e-post och stämma för en medlem.
// E-post byts även i inloggningskontot (auth.users), därför en Edge Function med service role.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const STAMMOR = ["Sopran", "Alt", "Tenor", "Bas", "Osäker"];
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Metoden stöds inte" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json({ error: "Inte inloggad" }, 401);
  const { data: caller } = await admin.from("members").select("role,status").eq("id", u.user.id).single();
  if (!caller || caller.role !== "admin" || caller.status !== "approved") return json({ error: "Kräver admin-behörighet" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig begäran" }, 400); }
  const id = String(body.id || "");
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const stamma = body.stamma ? String(body.stamma) : null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Ogiltigt id" }, 400);
  if (!name || name.length > 100) return json({ error: "Namn krävs (högst 100 tecken)" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: "Ogiltig e-postadress" }, 400);
  if (stamma && !STAMMOR.includes(stamma)) return json({ error: "Ogiltig stämma" }, 400);

  const { data: cur, error: curErr } = await admin.from("members").select("email").eq("id", id).single();
  if (curErr || !cur) return json({ error: "Medlemmen hittades inte" }, 404);
  const oldEmail = (cur.email || "").toLowerCase();

  let authChanged = false;
  if (email !== oldEmail) {
    const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
    if (error) return json({ error: "Kunde inte byta e-post: " + error.message }, 400);
    authChanged = true;
  }
  const { error: upErr } = await admin.from("members").update({ name, email, stamma }).eq("id", id);
  if (upErr) {
    if (authChanged && oldEmail) await admin.auth.admin.updateUserById(id, { email: oldEmail, email_confirm: true });
    return json({ error: upErr.message }, 400);
  }
  return json({ success: true, email_changed: authChanged });
});
