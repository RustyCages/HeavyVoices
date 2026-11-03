// forward-info-mail
// Tar emot mejl som skickats till info@heavyvoices.se (via ett Cloudflare Email Worker som POST:ar
// rå-mejlet hit) och skickar det vidare till ALLA godkända admins (members.role = 'admin').
// Admin-listan läses vid varje inkommande mejl, så ny admin får mejlen automatiskt.
// Mejlet sparas dessutom i inkorgen på sajten (admin/inkorg.html) via Edge Function inbox-receive.
//
// Varje admin får ett eget mejl (ser inte de andras adresser). Reply-To = ursprunglig avsändare.
//
// Anrop: POST med rått MIME-meddelande (message/rfc822) som body.
// Header: x-webhook-secret = samma värde som secret FORWARD_SECRET.
// Secrets: FORWARD_SECRET, RESEND_API_KEY. SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.

import { createClient } from "npm:@supabase/supabase-js@2";
import PostalMime from "npm:postal-mime@2";

const INFO_ADDRESS = "info@heavyvoices.se";
const OWN_ADDRESSES = new Set(["info@heavyvoices.se", "no-reply@heavyvoices.se"]);
const MAX_RAW_BYTES = 20 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Spara mejlet i inkorgen. Ett fel här får aldrig stoppa vidarebefordringen till admins.
async function saveToInbox(raw: Uint8Array, secret: string) {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/inbox-receive`, {
      method: "POST",
      headers: { "x-webhook-secret": secret, "Content-Type": "message/rfc822" },
      body: raw,
    });
    if (!res.ok) console.error("Inkorgen sparade inte mejlet:", res.status, await res.text());
  } catch (e) {
    console.error("Inkorgen kunde inte nås:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("FORWARD_SECRET");
  if (!secret || req.headers.get("x-webhook-secret") !== secret) {
    return json({ error: "Unauthorized" }, 401);
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY saknas" }, 500);

  const raw = new Uint8Array(await req.arrayBuffer());
  if (!raw.length) return json({ error: "Tomt meddelande" }, 400);
  if (raw.length > MAX_RAW_BYTES) return json({ error: "Meddelandet är för stort" }, 413);

  let email: any;
  try {
    email = await new PostalMime({ attachmentEncoding: "base64" }).parse(raw);
  } catch (e) {
    console.error("Kunde inte tolka mejlet:", e);
    return json({ error: "Kunde inte tolka mejlet" }, 400);
  }

  const fromAddr = String(email.from?.address ?? req.headers.get("x-envelope-from") ?? "").trim();
  const fromName = String(email.from?.name ?? "").trim();
  if (!fromAddr) return json({ skipped: "no sender" });

  // Loop-skydd: ignorera mejl från våra egna adresser och autosvar
  if (OWN_ADDRESSES.has(fromAddr.toLowerCase())) return json({ skipped: "own address" });
  const autoSubmitted = (email.headers ?? []).find((h: any) => h.key === "auto-submitted")?.value;
  if (autoSubmitted && String(autoSubmitted).toLowerCase() !== "no") {
    return json({ skipped: "auto-submitted" });
  }

  // Spara i inkorgen först, så att mejlet finns kvar även om utskicket nedan misslyckas
  await saveToInbox(raw, secret);

  // --- Mottagare: alla godkända admins med e-post, läses här och nu ---
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin
    .from("members")
    .select("email")
    .eq("role", "admin")
    .eq("status", "approved")
    .not("email", "is", null);
  if (error) {
    console.error("Kunde inte hämta admins:", error);
    return json({ error: "Could not load admins" }, 500);
  }
  const recipients = [...new Set((data ?? []).map((a: any) => String(a.email).trim()).filter(Boolean))];
  if (!recipients.length) return json({ error: "Inga admin-mottagare hittades" }, 500);

  // --- Bygg mejlet ---
  const label = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
  const subject = String(email.subject ?? "").trim() || "(inget ämne)";

  const banner =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#555;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;margin:0 0 16px;">` +
    `Mejl till ${INFO_ADDRESS} från <strong>${esc(label)}</strong>. Svara på mejlet för att svara avsändaren direkt, ` +
    `eller i <a href="https://heavyvoices.se/admin/inkorg.html">inkorgen på sajten</a>.</div>`;

  let html: string;
  if (email.html) {
    const original = String(email.html);
    html = /<body[^>]*>/i.test(original)
      ? original.replace(/<body[^>]*>/i, (m) => m + banner)
      : banner + original;
  } else {
    html = banner + `<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;">${esc(email.text ?? "")}</div>`;
  }
  const text = `Mejl till ${INFO_ADDRESS} från ${label}\n\n${email.text ?? ""}`;

  const attachments = (email.attachments ?? []).map((a: any, i: number) => ({
    filename: a.filename || `bilaga-${i + 1}`,
    content: a.content, // base64
  }));

  const displayName = (fromName || fromAddr).replace(/["<>,;:@\r\n]/g, " ").replace(/\s+/g, " ").trim();
  const from = `${displayName || "Avsändare"} via Heavy Voices <${INFO_ADDRESS}>`;

  // Ett mejl per admin (batch-API:t stöder inte bilagor). Håll oss under Resends rate limit.
  let sent = 0;
  const failed: string[] = [];
  for (let i = 0; i < recipients.length; i++) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [recipients[i]],
        subject,
        html,
        text,
        reply_to: fromAddr,
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    if (res.ok) {
      sent++;
    } else {
      console.error("Resend-fel:", res.status, await res.text());
      failed.push(recipients[i]);
    }
    if (i < recipients.length - 1) await sleep(600);
  }

  if (!sent) return json({ error: "Kunde inte skicka via Resend", failed }, 502);
  return json({ sent, failed });
});
