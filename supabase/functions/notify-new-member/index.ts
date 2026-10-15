// notify-new-member
// Anropas av triggers på public.members (via pg_net) och skickar mejl via Resend:
//  1. INSERT med status 'pending'        → mejl till alla godkända admins (ny registrering)
//  2. UPDATE 'pending' → 'approved'      → välkomstmejl till medlemmen (kontot godkänt)
//
// Välkomstmejlet är den brevmall i letter_templates som har send_on_approval = true
// (väljs under Medlemmar → Brevmallar, högst en åt gången). Ingen vald = inget välkomstmejl.
// Platshållare: {fornamn} {namn} {epost} {stamma} {datum}. Skickas från info@heavyvoices.se så att svar når kören.
//
// Secrets (Edge Functions → Secrets):
//   RESEND_API_KEY   – Resend API-nyckel (samma som används som SMTP-lösenord)
//   WEBHOOK_SECRET   – valfri lång slumpsträng, samma värde som headern x-webhook-secret i triggern
//   ADMIN_NOTIFY_EMAILS (valfri) – kommaseparerade adresser som ersätter admin-listan från databasen
// SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt i Edge Functions.

import { createClient } from "npm:@supabase/supabase-js@2";

const SITE_URL = "https://heavyvoices.se";
const FROM = "Heavy Voices <no-reply@heavyvoices.se>";      // admin-notisen
const WELCOME_FROM = "Heavy Voices <info@heavyvoices.se>";  // välkomstmejlet – svar går till kören
const WELCOME_SIGNATURE = "Hälsningar,\nHeavy Voices";
const LOGO_URL = "https://heavyvoices.se/icons/logo-large.png"; // vit logga, transparent PNG

// Brevhuvud med logga (används i admin-notisen)
const logoHeader = `<div style="text-align:center;margin:0 0 22px;padding-bottom:18px;border-bottom:1px solid #2a2f3a;"><img src="${LOGO_URL}" alt="HEAVY VOICES" width="160" style="display:block;margin:0 auto;width:160px;max-width:100%;height:auto;border:0;color:#9ca3af;font-size:13px;letter-spacing:0.04em;"></div>`;

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Bara triggern får anropa funktionen
  const secret = Deno.env.get("WEBHOOK_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const rec = payload?.record;
  if (payload?.table !== "members" || !rec) {
    return json({ skipped: "not a members event" });
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY saknas" }, 500);

  // ---- Kontot godkänt → välkomstmejl till medlemmen ----
  if (payload.type === "UPDATE") {
    const old = payload.old_record ?? {};
    if (old.status !== "pending" || rec.status !== "approved") {
      return json({ skipped: "not an approval" });
    }
    if (!rec.email) return json({ skipped: "member has no email" });
    return await sendWelcomeMail(apiKey, rec);
  }

  if (payload.type !== "INSERT") return json({ skipped: "unsupported event" });
  if (rec.status !== "pending") {
    // T.ex. medlemmar som admin lagt till/bjudit in direkt — ingen notis
    return json({ skipped: "status is not pending" });
  }

  // Mottagare: override från secret, annars alla godkända admins med e-post
  let recipients: string[] = (Deno.env.get("ADMIN_NOTIFY_EMAILS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (!recipients.length) {
    const { data, error } = await db()
      .from("members")
      .select("email")
      .eq("role", "admin")
      .eq("status", "approved")
      .not("email", "is", null);
    if (error) {
      console.error("Kunde inte hämta admins:", error);
      return json({ error: "Could not load admins" }, 500);
    }
    recipients = [...new Set((data ?? []).map((a: any) => a.email).filter(Boolean))];
  }

  if (!recipients.length) {
    console.warn("Inga admin-mottagare hittades");
    return json({ skipped: "no admin recipients" });
  }

  const name = rec.name || "(inget namn)";
  const when = new Date(rec.created_at ?? Date.now()).toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
  });
  const approveUrl = `${SITE_URL}/admin/medlemmar.html`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#121418;padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#1c2029;border:1px solid #2a2f3a;border-radius:12px;padding:24px;color:#f3f4f6;">
      ${logoHeader}
      <h2 style="margin:0 0 4px;color:#E5A968;font-family:'Roboto Condensed',Arial,sans-serif;">Ny registrering</h2>
      <p style="margin:0 0 18px;color:#9ca3af;">Någon väntar på att bli godkänd i Heavy Voices.</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px;">
        <tr><td style="padding:6px 0;color:#9ca3af;width:90px;">Namn</td><td style="padding:6px 0;"><strong>${esc(name)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#9ca3af;">E-post</td><td style="padding:6px 0;">${esc(rec.email || "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#9ca3af;">Stämma</td><td style="padding:6px 0;">${esc(rec.stamma || "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#9ca3af;">Tid</td><td style="padding:6px 0;">${esc(when)}</td></tr>
      </table>
      <p style="margin:24px 0 8px;">
        <a href="${approveUrl}" style="display:inline-block;background:#E5A968;color:#111317;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;">Öppna medlemmar och godkänn</a>
      </p>
      <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">Du får det här mejlet för att du är admin på heavyvoices.se.</p>
    </div>
  </div>`;

  const text =
    `Ny registrering i Heavy Voices\n\n` +
    `Namn: ${name}\nE-post: ${rec.email || "—"}\nStämma: ${rec.stamma || "—"}\nTid: ${when}\n\n` +
    `Godkänn här: ${approveUrl}\n`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: recipients,
      subject: `Ny registrering: ${name} väntar på godkännande`,
      html,
      text,
      ...(rec.email ? { reply_to: rec.email } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Resend-fel:", res.status, body);
    return json({ error: "Resend error", status: res.status }, 502);
  }

  return json({ sent: recipients.length });
});

// ---------- Välkomstmejl ----------

function firstName(name: unknown): string {
  return String(name ?? "").trim().split(/\s+/)[0] || "";
}

// Samma platshållare som i brevmallarna och send-member-email
function fillPlaceholders(text: string, r: any): string {
  const full = String(r.name ?? "").trim();
  const map: Record<string, string> = {
    fornamn: firstName(full),
    namn: full,
    epost: String(r.email ?? ""),
    stamma: String(r.stamma ?? ""),
    datum: new Date().toLocaleDateString("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm" }),
  };
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}

// Fritext → HTML: tomrad = nytt stycke, radbrytning = <br>, länkar blir klickbara
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => {
      const html = esc(p)
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#E5A968;">$1</a>')
        .replace(/\n/g, "<br>");
      return `<p style="margin:0 0 14px;line-height:1.55;">${html}</p>`;
    })
    .join("");
}

// Samma utseende som mejlen från Medlemmar → Skicka mejl
function wrapHtml(body: string, signature: string): string {
  const sigHtml = esc(signature).replace(/\n/g, "<br>");
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#121418;margin:0;padding:32px 20px;color:#f3f4f6;">
      <div style="max-width:680px;margin:0 auto;">
        <div style="text-align:center;margin:0 0 26px;padding-bottom:22px;border-bottom:1px solid #2a2f3a;">
          <img src="${LOGO_URL}" alt="HEAVY VOICES" width="180" style="display:block;margin:0 auto;width:180px;max-width:100%;height:auto;border:0;color:#9ca3af;font-size:13px;letter-spacing:0.04em;">
        </div>
        <div style="font-size:15px;">${textToHtml(body)}</div>
        <p style="margin:26px 0 0;color:#9ca3af;line-height:1.55;font-size:15px;">${sigHtml}</p>
        <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #2a2f3a;font-size:12px;color:#6b7280;">Du får det här mejlet för att ditt konto i Heavy Voices har godkänts. Svara på mejlet för att nå Heavy Voices.</p>
      </div>
    </div>`;
}

async function sendWelcomeMail(apiKey: string, rec: any) {
  // Den brevmall som är vald för automatiskt utskick
  const { data: tpl, error: tplErr } = await db()
    .from("letter_templates")
    .select("name, subject, body")
    .eq("send_on_approval", true)
    .limit(1)
    .maybeSingle();
  if (tplErr) {
    console.error("Kunde inte läsa brevmallen:", tplErr);
    return json({ error: "Could not load template" }, 500);
  }
  if (!tpl || !String(tpl.body || "").trim()) {
    return json({ skipped: "no template selected for approval" });
  }
  const subject = String(tpl.subject || "").trim() || "Välkommen till Heavy Voices, {fornamn}!";
  const body = String(tpl.body);

  const subj = fillPlaceholders(subject, rec);
  const msg = fillPlaceholders(body.replace(/\r\n?/g, "\n").trim(), rec);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: WELCOME_FROM,
      to: [rec.email],
      subject: subj,
      html: wrapHtml(msg, WELCOME_SIGNATURE),
      text: `${msg}\n\n${WELCOME_SIGNATURE}\n`,
    }),
  });
  if (!res.ok) {
    console.error("Resend-fel (välkomstmejl):", res.status, await res.text());
    return json({ error: "Resend error", status: res.status }, 502);
  }
  return json({ sent: 1, kind: "approved", template: tpl.name });
}
