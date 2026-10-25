// send-meeting-notes
// Skickar en mötesanteckning som mejl till valda medlemmar. Varje mottagare får ett eget mejl.
// Vem får skicka, och till vem:
//   - Admin och stämledare: till vilka godkända medlemmar som helst.
//   - Den som bokade mötet: bara till de som var inbjudna till just det mötet.
//   - Övriga: inget.
//
// Body: { note_id: string, member_ids: string[], subject?: string }
// Secrets: RESEND_API_KEY (finns redan). SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.
// Deployas med JWT-verifiering PÅ (standard): supabase functions deploy send-meeting-notes

import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = "Heavy Voices <info@heavyvoices.se>";
const LOGO_URL = "https://heavyvoices.se/icons/logo-large.png";
const TZ = "Europe/Stockholm";
const MAX_RECIPIENTS = 500;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function firstName(name: unknown): string {
  return String(name ?? "").trim().split(/\s+/)[0] || "";
}

function datumText(ev: any): string {
  return new Date(`${ev.event_date}T12:00:00`).toLocaleDateString("sv-SE", {
    day: "numeric", month: "long", year: "numeric", timeZone: TZ,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // --- Vem anropar? ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Ogiltig inloggning" }, 401);

  const { data: me } = await admin
    .from("members")
    .select("id, name, email, role, stamledare, status")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!me || me.status !== "approved") return json({ error: "Endast godkända medlemmar kan skicka anteckningar" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }

  const noteId = String(body?.note_id ?? "");
  const ids: string[] = Array.isArray(body?.member_ids) ? body.member_ids.map(String) : [];
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) return json({ error: "Ogiltig anteckning" }, 400);
  if (!ids.length) return json({ error: "Välj minst en mottagare" }, 400);
  if (ids.length > MAX_RECIPIENTS) return json({ error: `Max ${MAX_RECIPIENTS} mottagare` }, 400);

  // --- Anteckning och möte ---
  const { data: note } = await admin
    .from("meeting_notes").select("id, event_id, body").eq("id", noteId).maybeSingle();
  if (!note) return json({ error: "Anteckningen finns inte" }, 404);

  const { data: ev } = await admin
    .from("events").select("id, title, event_date, event_time, created_by, event_type")
    .eq("id", note.event_id).maybeSingle();

  const arEditor = me.role === "admin" || me.stamledare === true;
  const arBokare = !!ev && ev.created_by === me.id;

  if (!arEditor) {
    if (!arBokare) return json({ error: "Du kan bara skicka anteckningar för möten du bokat" }, 403);
    // Bokaren får bara skicka till dem som var inbjudna till mötet
    const { data: inbjudna } = await admin
      .from("meeting_invites").select("member_id").eq("event_id", ev!.id);
    const tillatna = new Set((inbjudna ?? []).map((r: any) => String(r.member_id)));
    if (ids.some((id) => !tillatna.has(id))) {
      return json({ error: "Du kan bara skicka till de som var inbjudna till mötet" }, 403);
    }
  }

  // --- Mottagare ---
  const { data: recipients, error: recErr } = await admin
    .from("members").select("id, name, email").in("id", ids).eq("status", "approved").not("email", "is", null);
  if (recErr) return json({ error: "Kunde inte hämta mottagare" }, 500);
  const mottagare = (recipients ?? []).filter((r: any) => r.email);
  if (!mottagare.length) return json({ error: "Inga giltiga mottagare" }, 400);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY saknas" }, 500);

  const defaultSubject = ev
    ? `Anteckningar från mötet: ${ev.title} (${datumText(ev)})`
    : "Anteckning från Heavy Voices";
  const subject = String(body?.subject ?? "").trim().slice(0, 150) || defaultSubject;
  const meddelande = String(note.body ?? "");

  let sent = 0;
  const failed: string[] = [];
  for (const m of mottagare) {
    const fornamn = firstName(m.name);
    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#121418;margin:0;padding:32px 20px;color:#f3f4f6;">
      <div style="max-width:680px;margin:0 auto;">
        <div style="text-align:center;margin:0 0 26px;padding-bottom:22px;border-bottom:1px solid #2a2f3a;">
          <img src="${LOGO_URL}" alt="HEAVY VOICES" width="180" style="display:block;margin:0 auto;width:180px;max-width:100%;height:auto;border:0;">
        </div>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hej ${esc(fornamn)}!</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">${esc(me.name || "Heavy Voices")} har skickat anteckningarna${ev ? ` från <strong>${esc(ev.title)}</strong> (${esc(datumText(ev))})` : ""}:</p>
        <div style="margin:0 0 18px;padding:14px 16px;border-left:3px solid #E5A968;background:#1b1e25;font-size:15px;line-height:1.55;white-space:pre-wrap;">${esc(meddelande)}</div>
        <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #2a2f3a;font-size:12px;color:#6b7280;">Du får det här mejlet som medlem i Heavy Voices.</p>
      </div>
    </div>`;
    const text = `Hej ${fornamn}!\n\n${me.name || "Heavy Voices"} har skickat anteckningarna${ev ? ` från ${ev.title} (${datumText(ev)})` : ""}:\n\n${meddelande}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [m.email], reply_to: me.email || undefined, subject, html, text }),
    });
    if (res.ok) sent++;
    else { failed.push(m.email); console.error("Anteckningsmejl misslyckades:", res.status, await res.text()); }
  }

  return json({ sent, failed: failed.length });
});
