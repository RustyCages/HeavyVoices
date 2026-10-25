// meeting-rsvp
// JSON-API för svarssidan (heavyvoices.se/mote-svar.html) och för svaret i kalendern.
// Ingen inloggning: åtkomsten styrs av den hemliga token som finns i varje inbjudan.
// GET  ?token=...        → mötets uppgifter och ditt nuvarande svar (ändrar inget)
// POST { token, svar }   → sparar svaret. När sista inbjudna svarat mejlas bokaren en sammanställning.
//
// Supabase skickar HTML från Edge Functions som text, därför renderas sidan på heavyvoices.se.
// Secrets: RESEND_API_KEY (finns redan).
// Deployas med "Verify JWT" AVSTÄNGT: supabase functions deploy meeting-rsvp --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = "Heavy Voices <info@heavyvoices.se>";
const TZ = "Europe/Stockholm";
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

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function nar(ev: any): string {
  const dag = new Date(`${ev.event_date}T12:00:00`).toLocaleDateString("sv-SE", {
    weekday: "long", day: "numeric", month: "long", timeZone: TZ,
  });
  const tid = (ev.event_time || "").slice(0, 5);
  return `${dag}${tid ? ` kl ${tid}` : ""}`;
}

// Mejlar bokaren när alla inbjudna har svarat. Anropas bara när det första svaret kommer från någon.
async function mejlaBokarenOmAllaSvarat(admin: any, ev: any, eventId: string) {
  const { data: rader, error } = await admin
    .from("meeting_invites")
    .select("response, members(name)")
    .eq("event_id", eventId);
  if (error || !rader?.length) return;
  if (rader.some((r: any) => !r.response)) return; // någon har inte svarat ännu

  const { data: bokare } = await admin
    .from("members").select("name, email").eq("id", ev.created_by).maybeSingle();
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!bokare?.email || !apiKey) return;

  const namn = (s: string) => rader
    .filter((r: any) => r.response === s)
    .map((r: any) => (r.members as any)?.name ?? "Okänd")
    .sort((a: string, b: string) => a.localeCompare(b, "sv"));
  const ja = namn("ja");
  const kanske = namn("kanske");
  const nej = namn("nej");
  const fornamn = String(bokare.name ?? "").trim().split(/\s+/)[0] || "";
  const lista = (etikett: string, n: string[]) =>
    `<p style="margin:0 0 8px;font-size:15px;"><strong>${etikett} (${n.length}):</strong> ${n.length ? esc(n.join(", ")) : "–"}</p>`;
  const listaText = (etikett: string, n: string[]) => `${etikett} (${n.length}): ${n.length ? n.join(", ") : "–"}`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#121418;margin:0;padding:32px 20px;color:#f3f4f6;">
    <div style="max-width:680px;margin:0 auto;">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hej ${esc(fornamn)}!</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Alla inbjudna har svarat på <strong>${esc(ev.title)}</strong> (${esc(nar(ev))}).</p>
      ${lista("Ja", ja)}${lista("Kanske", kanske)}${lista("Nej", nej)}
      <p style="margin:18px 0 0;font-size:13px;color:#9ca3af;">Du ser svaren även under Möten i kalendern på heavyvoices.se.</p>
    </div>
  </div>`;
  const text = [
    `Hej ${fornamn}!`,
    `Alla inbjudna har svarat på ${ev.title} (${nar(ev)}).`,
    listaText("Ja", ja),
    listaText("Kanske", kanske),
    listaText("Nej", nej),
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [bokare.email],
      subject: `Alla har svarat: ${ev.title}`,
      html,
      text,
    }),
  });
  if (!res.ok) console.error("Påminnelse till bokaren misslyckades:", res.status, await res.text());
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
    .select("id, event_id, response, events(title, event_date, event_time, end_time, meeting_url, event_type, created_by), members(name)")
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
  const forstaSvaret = !inv.response;
  const { error } = await admin
    .from("meeting_invites")
    .update({ response: svar, responded_at: new Date().toISOString() })
    .eq("id", inv.id);
  if (error) return json({ error: "Svaret kunde inte sparas. Försök igen om en stund." }, 500);

  if (forstaSvaret) {
    try {
      await mejlaBokarenOmAllaSvarat(admin, ev, inv.event_id);
    } catch (e) {
      console.error("Påminnelse till bokaren kastade fel:", e);
    }
  }

  return json({ ...info, response: svar, saved: true });
});
