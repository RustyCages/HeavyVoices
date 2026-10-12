// send-member-email
// Admin skickar ett mejl till valda medlemmar (anropas från admin/medlemmar.html).
// Varje mottagare får ett eget mejl (ser inte de andras adresser). Mejlet skickas från info@heavyvoices.se,
// så svar går dit (ingen separat Reply-To behövs, vilket håller nere antalet rader i Gmails detaljruta).
//
// Body: { subject: string, message: string, member_ids: string[], signature_id?: string }
// Platshållare i ämne/meddelande (samma som i brevmallarna, admin/brevmallar.html):
//   {fornamn} förnamn, {namn} hela namnet, {epost} e-post, {stamma} stämma, {datum} dagens datum.
// signature_id = rad i tabellen email_signatures. Utan (eller om den inte hittas) används "Hälsningar, <avsändarens namn>, Heavy Voices".
//
// Secrets: RESEND_API_KEY (samma som för notify-new-member).
// SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.

import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = "Heavy Voices <info@heavyvoices.se>"; // svar går hit (admins får dem via forward-info-mail)
const LOGO_URL = "https://heavyvoices.se/icons/logo-large.png"; // vit logga, transparent PNG
const MAX_RECIPIENTS = 500;
const BATCH_SIZE = 100; // Resend batch-gräns

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

// Byter {fornamn}, {namn}, {epost}, {stamma}, {datum}; okända platshållare lämnas orörda
function fillPlaceholders(text: string, r: any, today: string): string {
  const full = String(r.name ?? "").trim();
  const map: Record<string, string> = {
    fornamn: firstName(full),
    namn: full,
    epost: String(r.email ?? ""),
    stamma: String(r.stamma ?? ""),
    datum: today,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // --- Vem anropar? Måste vara inloggad, godkänd admin ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Ogiltig inloggning" }, 401);

  const { data: sender, error: senderErr } = await admin
    .from("members")
    .select("id, name, email, role, status")
    .eq("id", userData.user.id)
    .single();
  if (senderErr || !sender || sender.role !== "admin" || sender.status !== "approved") {
    return json({ error: "Endast admin får skicka mejl" }, 403);
  }

  // --- Indata ---
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }
  const subject = String(body?.subject ?? "").trim();
  const message = String(body?.message ?? "").replace(/\r\n?/g, "\n").trim();
  const ids: string[] = Array.isArray(body?.member_ids) ? body.member_ids.map(String) : [];
  const signatureId = body?.signature_id ? String(body.signature_id) : "";

  if (!subject) return json({ error: "Ämne saknas" }, 400);
  if (!message) return json({ error: "Meddelande saknas" }, 400);
  if (!ids.length) return json({ error: "Inga mottagare valda" }, 400);
  if (ids.length > MAX_RECIPIENTS) return json({ error: `Max ${MAX_RECIPIENTS} mottagare per utskick` }, 400);

  const { data: recipients, error: recErr } = await admin
    .from("members")
    .select("id, name, email, stamma")
    .in("id", ids)
    .not("email", "is", null);
  if (recErr) return json({ error: "Kunde inte hämta mottagare" }, 500);

  // Unika adresser
  const seen = new Set<string>();
  const list = (recipients ?? []).filter((r: any) => {
    const e = String(r.email).toLowerCase();
    if (!e || seen.has(e)) return false;
    seen.add(e);
    return true;
  });
  if (!list.length) return json({ error: "Ingen av de valda har en e-postadress" }, 400);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY saknas" }, 500);

  // --- Signatur: vald signatur, annars "Hälsningar, <namn>, Heavy Voices" ---
  let signatureText = `Hälsningar,\n${sender.name || "Heavy Voices"}\nHeavy Voices`;
  if (signatureId) {
    const { data: sig, error: sigErr } = await admin
      .from("email_signatures")
      .select("body")
      .eq("id", signatureId)
      .maybeSingle();
    if (sigErr) console.error("Kunde inte läsa signatur:", sigErr);
    else if (sig?.body) signatureText = String(sig.body).replace(/\r\n?/g, "\n").trim();
  }
  const signatureHtml = esc(signatureText)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#E5A968;">$1</a>')
    .replace(/\n/g, "<br>");

  const today = new Date().toLocaleDateString("sv-SE", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm",
  });

  const emails = list.map((r: any) => {
    const subj = fillPlaceholders(subject, r, today);
    const msg = fillPlaceholders(message, r, today);
    // Hela mejlet är en enda mörk yta (ingen ruta med kant). Innehållet centreras i en bredare kolumn.
    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#121418;margin:0;padding:32px 20px;color:#f3f4f6;">
      <div style="max-width:680px;margin:0 auto;">
        <div style="text-align:center;margin:0 0 26px;padding-bottom:22px;border-bottom:1px solid #2a2f3a;">
          <img src="${LOGO_URL}" alt="HEAVY VOICES" width="180" style="display:block;margin:0 auto;width:180px;max-width:100%;height:auto;border:0;color:#9ca3af;font-size:13px;letter-spacing:0.04em;">
        </div>
        <div style="font-size:15px;">${textToHtml(msg)}</div>
        <p style="margin:26px 0 0;color:#9ca3af;line-height:1.55;font-size:15px;">${signatureHtml}</p>
        <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #2a2f3a;font-size:12px;color:#6b7280;">Du får det här mejlet som medlem i Heavy Voices. Svara på mejlet för att nå Heavy Voices.</p>
      </div>
    </div>`;
    return {
      from: FROM,
      to: [r.email],
      subject: subj,
      html,
      text: `${msg}\n\n${signatureText}\n`,
    };
  });

  let sent = 0;
  const failed: string[] = [];
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const chunk = emails.slice(i, i + BATCH_SIZE);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (res.ok) {
      sent += chunk.length;
    } else {
      console.error("Resend batch-fel:", res.status, await res.text());
      chunk.forEach((e) => failed.push(e.to[0]));
    }
    if (i + BATCH_SIZE < emails.length) await sleep(600); // håll oss under Resends rate limit
  }

  if (!sent) return json({ error: "Kunde inte skicka via Resend", failed }, 502);
  return json({ sent, failed });
});
