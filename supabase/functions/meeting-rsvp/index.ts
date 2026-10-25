// meeting-rsvp
// Svarssidan som öppnas från knapparna i mötesmejlet. Ingen inloggning: åtkomsten styrs av den
// hemliga token som finns i varje inbjudan.
// GET  ?token=...        → visar mötet och knappar (ingen ändring sker vid GET, så att länkförhandsgranskare inte svarar åt dig)
// POST (form) token, svar → sparar svaret och visar en bekräftelse
//
// Deployas med "Verify JWT" AVSTÄNGT (publik funktion): supabase functions deploy meeting-rsvp --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const TZ = "Europe/Stockholm";
const SVAR = ["ja", "nej", "kanske"] as const;
const ETIKETT: Record<string, string> = { ja: "Ja", nej: "Nej", kanske: "Kanske" };

function html(status: number, title: string, inner: string) {
  const page = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;background:#121418;color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:40px 20px;">
<h1 style="font-size:22px;color:#E5A968;margin:0 0 18px;">Heavy Voices</h1>
${inner}
</div></body></html>`;
  return new Response(page, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  let token = "";
  let svar = "";
  let forvald = "";
  if (req.method === "POST") {
    const form = await req.formData().catch(() => null);
    token = String(form?.get("token") ?? "");
    svar = String(form?.get("svar") ?? "");
  } else if (req.method === "GET") {
    const url = new URL(req.url);
    token = url.searchParams.get("token") ?? "";
    forvald = url.searchParams.get("svar") ?? "";
  } else {
    return html(405, "Fel", "<p>Ogiltig förfrågan.</p>");
  }

  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return html(400, "Ogiltig länk", "<p>Länken är inte giltig. Använd knappen i mejlet igen.</p>");
  }

  const { data: inv } = await admin
    .from("meeting_invites")
    .select("id, token, response, events(title, event_date, event_time, end_time, meeting_url, event_type), members(name)")
    .eq("token", token)
    .maybeSingle();

  if (!inv || !inv.events || (inv.events as any).event_type !== "mote") {
    return html(404, "Hittades inte", "<p>Mötet finns inte längre. Det kan ha blivit inställt.</p>");
  }
  const ev = inv.events as any;
  const fornamn = String((inv.members as any)?.name ?? "").trim().split(/\s+/)[0] || "";

  if (req.method === "POST") {
    if (!SVAR.includes(svar as any)) {
      return html(400, "Ogiltigt svar", "<p>Svaret är inte giltigt.</p>");
    }
    const { error } = await admin.from("meeting_invites")
      .update({ response: svar, responded_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (error) return html(500, "Fel", "<p>Svaret kunde inte sparas. Försök igen om en stund.</p>");

    return html(200, "Tack", `
      <p style="font-size:17px;margin:0 0 10px;">Tack${fornamn ? `, ${esc(fornamn)}` : ""}!</p>
      <p style="margin:0 0 18px;">Du har svarat <strong>${ETIKETT[svar]}</strong> på <strong>${esc(ev.title)}</strong> (${esc(nar(ev))}).</p>
      <p style="margin:0 0 18px;font-size:14px;color:#9ca3af;">Du kan ändra svaret med knappen i mejlet.</p>
      <p style="margin:0;"><a href="${esc(ev.meeting_url)}" style="color:#E5A968;">Gå till videomötet</a></p>`);
  }

  // GET: visa mötet och svarsknapparna
  const nu = inv.response ? `Ditt nuvarande svar: <strong>${ETIKETT[inv.response]}</strong>.` : "Du har inte svarat än.";
  const valjLista = (SVAR as readonly string[]).includes(forvald) ? [forvald] : [...SVAR];
  const etikettText = (s: string) => (valjLista.length === 1 ? `Bekräfta: ${ETIKETT[s]}` : ETIKETT[s]);
  const knappar = valjLista.map((s) => `
    <button type="submit" name="svar" value="${s}" style="margin:0 8px 10px 0;padding:12px 20px;border-radius:8px;border:0;font-size:15px;font-weight:bold;cursor:pointer;background:${s === "ja" ? "#E5A968" : "#2a2f3a"};color:${s === "ja" ? "#111317" : "#f3f4f6"};">${etikettText(s)}</button>`).join("")
    + (valjLista.length === 1 ? `<p style="margin:10px 0 0;font-size:14px;"><a href="${esc(new URL(req.url).pathname)}?token=${esc(token)}" style="color:#9ca3af;">Välj ett annat svar</a></p>` : "");

  return html(200, esc(ev.title), `
    <p style="font-size:17px;margin:0 0 6px;">${esc(ev.title)}</p>
    <p style="margin:0 0 6px;color:#d1d5db;">${esc(nar(ev))}</p>
    <p style="margin:0 0 20px;color:#9ca3af;font-size:14px;">${nu}</p>
    <form method="POST" action="${esc(new URL(req.url).pathname)}">
      <input type="hidden" name="token" value="${esc(token)}">
      ${knappar}
    </form>
    <p style="margin:18px 0 0;"><a href="${esc(ev.meeting_url)}" style="color:#E5A968;">Gå till videomötet</a></p>`);
});
