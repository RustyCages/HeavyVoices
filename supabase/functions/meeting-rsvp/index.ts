// meeting-rsvp
// JSON-API för svarssidan (heavyvoices.se/mote-svar.html) och för svaret i kalendern.
// Ingen inloggning: åtkomsten styrs av den hemliga token som finns i varje inbjudan.
// GET  ?token=...        → mötets uppgifter och ditt nuvarande svar (ändrar inget)
// POST { token, svar }   → sparar svaret
//
// Supabase skickar HTML från Edge Functions som text, därför renderas sidan på heavyvoices.se.
// Deployas med "Verify JWT" AVSTÄNGT: supabase functions deploy meeting-rsvp --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const SVAR = ["ja", "nej", "kanske"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let token = "";
  let svar = "";
  if (req.method === "GET") {
    token = new URL(req.url).searchParams.get("token") ?? "";
  } else if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    token = String(body?.token ?? "");
    svar = String(body?.svar ?? "");
  } else {
    return json({ error: "Ogiltig förfrågan" }, 405);
  }

  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return json({ error: "Länken är inte giltig. Använd knappen i mejlet igen." }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: inv } = await admin
    .from("meeting_invites")
    .select("id, response, events(title, event_date, event_time, end_time, meeting_url, event_type), members(name)")
    .eq("token", token)
    .maybeSingle();

  if (!inv || !inv.events || (inv.events as any).event_type !== "mote") {
    return json({ error: "Mötet finns inte längre. Det kan ha blivit inställt." }, 404);
  }

  const ev = inv.events as any;
  const fornamn = String((inv.members as any)?.name ?? "").trim().split(/\s+/)[0] || "";
  const info = {
    title: ev.title,
    event_date: ev.event_date,
    event_time: ev.event_time,
    end_time: ev.end_time,
    meeting_url: ev.meeting_url,
    fornamn,
  };

  if (req.method === "GET") return json({ ...info, response: inv.response });

  if (!SVAR.includes(svar)) return json({ error: "Ogiltigt svar" }, 400);
  const { error } = await admin
    .from("meeting_invites")
    .update({ response: svar, responded_at: new Date().toISOString() })
    .eq("id", inv.id);
  if (error) return json({ error: "Svaret kunde inte sparas. Försök igen om en stund." }, 500);

  return json({ ...info, response: svar, saved: true });
});
