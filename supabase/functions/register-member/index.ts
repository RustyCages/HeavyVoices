// register-member — självregistrering från /registrera.html
// SÄKERHET (2026-11-17): servern kontrollerar nu själv att registreringen är öppen
// (site_settings.registration_open). Tidigare spärrades bara knappen i webbläsaren,
// så vem som helst kunde skapa konton via ett direkt anrop.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

const STAMMOR = ["Sopran", "Alt", "Tenor", "Bas", "Osäker"]; // samma värden som i registrera.html
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // 1. Är registreringen öppen? (fail closed)
  const { data: setting } = await admin.from("site_settings").select("value").eq("key", "registration_open").maybeSingle();
  if (String(setting?.value ?? "false") !== "true") {
    return json({ error: "Registreringen är stängd" }, 403);
  }

  // 2. Validera indata
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }
  const name = String(body?.name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const stamma = String(body?.stamma ?? "").trim();

  if (!name || name.length > 80) return json({ error: "Ange ett namn (max 80 tecken)" }, 400);
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "Ogiltig e-postadress" }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: "Lösenordet måste vara minst 10 tecken" }, 400);
  if (!STAMMOR.includes(stamma)) return json({ error: "Ogiltig stämma" }, 400);

  // 3. Skapa kontot (status pending – admin måste godkänna innan något blir synligt).
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  // Samma svar oavsett om adressen redan finns, så att formuläret inte avslöjar vilka som är medlemmar.
  if (createError) return json({ success: true });

  const { error: insertError } = await admin.from("members").insert({
    id: created.user.id, name, email, stamma, role: "medlem", status: "pending",
  });
  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: "Registreringen misslyckades" }, 500);
  }
  return json({ success: true });
});
