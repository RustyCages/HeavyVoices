// meeting-invite
// Godkända medlemmar bokar möten: skapar händelsen, en egen Jitsi-länk, och mejlar de inbjudna
// med tid, videolänk, svarsknappar (ja / nej / kanske) och en kalenderfil (.ics).
// Samma funktion avbokar: skickar avbokningsmejl med ICS (METHOD:CANCEL) och tar bort mötet.
//
// Body:
//   { action: "create", title, date: "YYYY-MM-DD", time: "HH:MM", end_time?: "HH:MM", notes?: string, member_ids: string[] }
//   { action: "cancel", event_id: string }
//
// Regler: bokaren måste vara godkänd medlem. Max 5 bokningar per medlem och dygn, max 100 inbjudna per möte.
// Admin får avboka alla möten, andra medlemmar bara sina egna.
// Secrets: RESEND_API_KEY (finns redan). SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.
// Deployas separat: supabase functions deploy meeting-invite (JWT-verifiering på).

import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = "Heavy Voices <info@heavyvoices.se>";
const LOGO_URL = "https://heavyvoices.se/icons/logo-large.png";
const TZ = "Europe/Stockholm";
const MAX_INVITEES = 100;
const MAX_PER_DAY = 5;

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

// Svensk lokal tid (Europe/Stockholm) → UTC-Date
function tzOffsetMs(t: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t));
  const v: Record<string, number> = {};
  p.forEach((x) => { if (x.type !== "literal") v[x.type] = Number(x.value); });
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - t;
}
function stockholmToUtc(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = tzOffsetMs(guess);
  let utc = guess - off;
  const off2 = tzOffsetMs(utc);
  if (off2 !== off) utc = guess - off2;
  return new Date(utc);
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line: string): string {
  // ICS: rader max 75 tecken, fortsättning börjar med ett blanksteg
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) { out.push(rest.slice(0, 73)); rest = rest.slice(73); }
  out.push(rest);
  return out.join("\r\n ");
}
function b64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function buildIcs(ev: any, method: "REQUEST" | "CANCEL", seq: number): string {
  const start = stockholmToUtc(ev.event_date, (ev.event_time || "19:00").slice(0, 5));
  const end = ev.end_time
    ? stockholmToUtc(ev.event_date, ev.end_time.slice(0, 5))
    : new Date(start.getTime() + 60 * 60 * 1000);
  const desc = [ev.notes ? ev.notes : "", ev.meeting_url ? `Videomöte: ${ev.meeting_url}` : ""]
    .filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Heavy Voices//Moten//SV",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${ev.id}@heavyvoices.se`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SEQUENCE:${seq}`,
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    `SUMMARY:${icsText(ev.title)}`,
    `DESCRIPTION:${icsText(desc)}`,
    ev.meeting_url ? `LOCATION:${icsText(ev.meeting_url)}` : "",
    ev.meeting_url ? `URL:${ev.meeting_url}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.map(fold).join("\r\n") + "\r\n";
}

function whenText(ev: any): string {
  // Lokal svensk dag: middag UTC-tid på rätt datum ger rätt veckodag i Stockholm
  const dag = stockholmToUtc(ev.event_date, "12:00").toLocaleDateString("sv-SE", {
    weekday: "long", day: "numeric", month: "long", timeZone: TZ,
  });
  const tid = (ev.event_time || "").slice(0, 5);
  const slut = (ev.end_time || "").slice(0, 5);
  return `${dag}${tid ? ` kl ${tid}` : ""}${slut ? `–${slut}` : ""}`;
}

const RSVP_BASE = (supabaseUrl: string) => `${supabaseUrl}/functions/v1/meeting-rsvp`;

function inviteHtml(ev: any, bokare: string, mottagare: any, rsvpBase: string): string {
  const knapp = (svar: string, label: string, bg: string, fg: string) =>
    `<a href="${rsvpBase}?token=${mottagare.token}&amp;svar=${svar}" style="display:inline-block;margin:0 6px 8px 0;padding:11px 18px;border-radius:8px;background:${bg};color:${fg};text-decoration:none;font-weight:bold;font-size:15px;">${label}</a>`;
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#121418;margin:0;padding:32px 20px;color:#f3f4f6;">
    <div style="max-width:680px;margin:0 auto;">
      <div style="text-align:center;margin:0 0 26px;padding-bottom:22px;border-bottom:1px solid #2a2f3a;">
        <img src="${LOGO_URL}" alt="HEAVY VOICES" width="180" style="display:block;margin:0 auto;width:180px;max-width:100%;height:auto;border:0;">
      </div>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hej ${esc(mottagare.fornamn)}!</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">${esc(bokare)} har bokat ett möte:</p>
      <div style="margin:0 0 18px;padding:14px 16px;border-left:3px solid #E5A968;background:#1b1e25;">
        <div style="font-size:18px;font-weight:bold;margin-bottom:6px;">${esc(ev.title)}</div>
        <div style="font-size:15px;color:#d1d5db;">${esc(whenText(ev))}</div>
        ${ev.notes ? `<div style="font-size:14px;color:#9ca3af;margin-top:8px;white-space:pre-line;">${esc(ev.notes)}</div>` : ""}
      </div>
      <p style="margin:0 0 10px;font-size:15px;"><a href="${ev.meeting_url}" style="color:#E5A968;font-weight:bold;">Gå med i videomötet</a></p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#d1d5db;">
        Så här går du med: klicka på länken i tid. Tillåt mikrofon och kamera när webbläsaren frågar.
        Inget konto behövs. Använd hörlurar så att mikrofonen inte fångar upp ljudet från högtalaren.
        På mobilen kan du också installera Jitsi Meet-appen och öppna länken där.
      </p>
      <p style="margin:18px 0 8px;font-size:15px;">Kan du komma?</p>
      <div>
        ${knapp("ja", "Ja", "#E5A968", "#111317")}
        ${knapp("kanske", "Kanske", "#2a2f3a", "#f3f4f6")}
        ${knapp("nej", "Nej", "#2a2f3a", "#f3f4f6")}
      </div>
      <p style="margin:18px 0 0;font-size:13px;color:#9ca3af;">Kalenderfilen (.ics) är bifogad och kan läggas till i din kalender. Ändra ditt svar när som helst med knapparna ovan.</p>
      <p style="margin:26px 0 0;padding-top:16px;border-top:1px solid #2a2f3a;font-size:12px;color:#6b7280;">Du får det här mejlet som medlem i Heavy Voices.</p>
    </div>
  </div>`;
}

function cancelHtml(ev: any, bokare: string, fornamn: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#121418;margin:0;padding:32px 20px;color:#f3f4f6;">
    <div style="max-width:680px;margin:0 auto;">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Hej ${esc(fornamn)}!</p>
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">Mötet <strong>${esc(ev.title)}</strong> (${esc(whenText(ev))}) är inställt av ${esc(bokare)}.</p>
      <p style="margin:0;font-size:13px;color:#9ca3af;">Den bifogade kalenderfilen tar bort mötet från din kalender.</p>
    </div>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // --- Vem anropar? ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Ogiltig inloggning" }, 401);

  const { data: me, error: meErr } = await admin
    .from("members")
    .select("id, name, email, role, status")
    .eq("id", userData.user.id)
    .single();
  if (meErr || !me || me.status !== "approved") return json({ error: "Endast godkända medlemmar kan boka möten" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY saknas" }, 500);

  // --- Avboka ---
  if (body?.action === "cancel") {
    const eventId = String(body?.event_id ?? "");
    const { data: ev } = await admin.from("events").select("*").eq("id", eventId).maybeSingle();
    if (!ev || ev.event_type !== "mote") return json({ error: "Mötet finns inte" }, 404);
    if (ev.created_by !== me.id && me.role !== "admin") return json({ error: "Du kan bara avboka dina egna möten" }, 403);

    const { data: invites } = await admin
      .from("meeting_invites").select("member_id, members(name, email)").eq("event_id", eventId);
    const bokare = (await admin.from("members").select("name").eq("id", ev.created_by).maybeSingle()).data?.name || me.name;
    const ics = buildIcs(ev, "CANCEL", 1);
    const mejl = (invites ?? []).map((i: any) => i.members).filter((m: any) => m?.email);
    let sent = 0;
    for (const m of mejl) {
      const fornamn = String(m.name ?? "").trim().split(/\s+/)[0] || "";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [m.email],
          subject: `Inställt: ${ev.title}`,
          html: cancelHtml(ev, bokare, fornamn),
          text: `Hej ${fornamn}! Mötet ${ev.title} (${whenText(ev)}) är inställt av ${bokare}.`,
          attachments: [{ filename: "mote-avbokat.ics", content: b64(ics) }],
        }),
      });
      if (res.ok) sent++; else console.error("Avbokningsmejl misslyckades:", res.status, await res.text());
    }
    await admin.from("events").delete().eq("id", eventId);
    return json({ cancelled: true, sent });
  }

  // --- Skapa ---
  if (body?.action !== "create") return json({ error: "Okänd åtgärd" }, 400);

  const title = String(body?.title ?? "").trim().slice(0, 120);
  const date = String(body?.date ?? "");
  const time = String(body?.time ?? "");
  const endTime = String(body?.end_time ?? "");
  const notes = String(body?.notes ?? "").trim().slice(0, 1000);
  const ids: string[] = Array.isArray(body?.member_ids) ? body.member_ids.map(String) : [];

  if (!title) return json({ error: "Titel saknas" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Ogiltigt datum" }, 400);
  if (!/^\d{2}:\d{2}$/.test(time)) return json({ error: "Ogiltig tid" }, 400);
  if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) return json({ error: "Ogiltig sluttid" }, 400);
  if (!ids.length) return json({ error: "Välj minst en inbjuden" }, 400);
  if (ids.length > MAX_INVITEES) return json({ error: `Max ${MAX_INVITEES} inbjudna` }, 400);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin.from("events").select("id", { count: "exact", head: true })
    .eq("created_by", me.id).eq("event_type", "mote").gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_DAY) return json({ error: `Max ${MAX_PER_DAY} bokningar per dygn` }, 429);

  const { data: recipients, error: recErr } = await admin
    .from("members").select("id, name, email").in("id", ids).eq("status", "approved").not("email", "is", null);
  if (recErr) return json({ error: "Kunde inte hämta mottagare" }, 500);
  const mottagare = (recipients ?? []).filter((r: any) => r.id !== me.id && r.email);
  if (!mottagare.length) return json({ error: "Inga giltiga mottagare" }, 400);

  // Jitsi: egen, svårgissad rumsnamn per möte
  const slump = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const meetingUrl = `https://meet.jit.si/HeavyVoices-Mote-${slump}`;

  const { data: ev, error: evErr } = await admin.from("events").insert({
    title,
    event_type: "mote",
    event_date: date,
    event_time: time,
    end_time: endTime || null,
    notes: notes || null,
    created_by: me.id,
    meeting_url: meetingUrl,
  }).select("*").single();
  if (evErr || !ev) return json({ error: "Kunde inte spara mötet" }, 500);

  const { data: invites, error: invErr } = await admin.from("meeting_invites")
    .insert(mottagare.map((m: any) => ({ event_id: ev.id, member_id: m.id })))
    .select("token, member_id");
  if (invErr || !invites) {
    await admin.from("events").delete().eq("id", ev.id);
    return json({ error: "Kunde inte spara inbjudningar" }, 500);
  }
  const tokenByMember = new Map(invites.map((i: any) => [i.member_id, i.token]));

  const ics = buildIcs(ev, "REQUEST", 0);
  const rsvpBase = RSVP_BASE(SUPABASE_URL);
  const failed: string[] = [];
  let sent = 0;
  for (const m of mottagare) {
    const fornamn = String(m.name ?? "").trim().split(/\s+/)[0] || "";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [m.email],
        subject: `Möte: ${title}, ${whenText(ev)}`,
        html: inviteHtml(ev, me.name || "Heavy Voices", { fornamn, token: tokenByMember.get(m.id) }, rsvpBase),
        text: `Hej ${fornamn}! ${me.name} har bokat ett möte: ${title}, ${whenText(ev)}.\n\nGå med i videomötet: ${meetingUrl}\n\nSvara: ${rsvpBase}?token=${tokenByMember.get(m.id)}`,
        attachments: [{ filename: "mote.ics", content: b64(ics) }],
      }),
    });
    if (res.ok) sent++;
    else { failed.push(m.email); console.error("Inbjudan misslyckades:", res.status, await res.text()); }
  }

  return json({ event_id: ev.id, meeting_url: meetingUrl, sent, failed });
});
