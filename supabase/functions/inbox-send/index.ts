// inbox-send
// Admin svarar på en tråd i inkorgen (admin/inkorg.html). Svaret skickas från info@heavyvoices.se via Resend,
// med In-Reply-To/References så att det hamnar i rätt tråd hos mottagaren, och sparas i inbox_messages.
//
// Body: { thread_id: string, message: string, signature_id?: string }
// Svaret går till avsändaren av det senaste inkommande mejlet i tråden.
//
// Secrets: RESEND_API_KEY. SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.

import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = "Heavy Voices <info@heavyvoices.se>";
const DOMAIN = "heavyvoices.se";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const textToHtml = (text: string) =>
  text.split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 12px;line-height:1.5;">${esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</p>`
  ).join("");

const reSubject = (s: string) => (/^\s*(re|sv)\s*:/i.test(s) ? s : `Sv: ${s || "(inget ämne)"}`);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // --- Bara godkänd admin ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: u, error: uErr } = await db.auth.getUser(token);
  if (uErr || !u?.user) return json({ error: "Ogiltig inloggning" }, 401);
  const { data: sender } = await db.from("members").select("id, name, role, status").eq("id", u.user.id).single();
  if (!sender || sender.role !== "admin" || sender.status !== "approved") {
    return json({ error: "Endast admin får svara på mejl" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }
  const threadId = String(body?.thread_id ?? "");
  const message = String(body?.message ?? "").replace(/\r\n?/g, "\n").trim();
  const signatureId = body?.signature_id ? String(body.signature_id) : "";
  if (!threadId) return json({ error: "Tråd saknas" }, 400);
  if (!message) return json({ error: "Skriv ett svar först" }, 400);
  if (message.length > 20000) return json({ error: "Svaret är för långt" }, 400);

  // --- Tråden: svara på det senaste inkommande mejlet ---
  const { data: msgs, error: tErr } = await db.from("inbox_messages")
    .select("id, direction, message_id, refs, from_email, from_name, subject, text_body, created_at")
    .eq("thread_id", threadId).order("created_at", { ascending: true });
  if (tErr) return json({ error: tErr.message }, 500);
  const last = [...(msgs ?? [])].reverse().find((m) => m.direction === "in");
  if (!last?.from_email) return json({ error: "Hittar ingen avsändare att svara till" }, 400);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY saknas" }, 500);

  // --- Signatur: vald signatur, annars "Hälsningar, <namn>, Heavy Voices" ---
  let signature = `Hälsningar,\n${sender.name || "Heavy Voices"}\nHeavy Voices`;
  if (signatureId) {
    const { data: sig } = await db.from("email_signatures").select("body").eq("id", signatureId).maybeSingle();
    if (sig?.body) signature = String(sig.body).replace(/\r\n?/g, "\n").trim();
  }

  // --- Citat av mejlet vi svarar på ---
  const when = new Date(last.created_at).toLocaleString("sv-SE", {
    dateStyle: "long", timeStyle: "short", timeZone: "Europe/Stockholm",
  });
  const who = last.from_name ? `${last.from_name} <${last.from_email}>` : last.from_email;
  const quoteText = (last.text_body ?? "").trim().slice(0, 20000);
  const quoteIntro = `Den ${when} skrev ${who}:`;

  const subject = reSubject(last.subject ?? "");
  const newMessageId = `<${crypto.randomUUID()}@${DOMAIN}>`;
  const refs = [last.refs, last.message_id].filter(Boolean).join(" ").trim();

  const text = `${message}\n\n${signature}\n` +
    (quoteText ? `\n${quoteIntro}\n${quoteText.split("\n").map((l) => "> " + l).join("\n")}\n` : "");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111;">` +
    textToHtml(message) +
    `<p style="margin:18px 0 0;line-height:1.5;color:#444;">${esc(signature).replace(/\n/g, "<br>")}</p>` +
    (quoteText
      ? `<p style="margin:24px 0 6px;color:#666;font-size:13px;">${esc(quoteIntro)}</p>` +
        `<blockquote style="margin:0;padding:0 0 0 12px;border-left:3px solid #ccc;color:#555;">${esc(quoteText).replace(/\n/g, "<br>")}</blockquote>`
      : "") +
    `</div>`;

  const headers: Record<string, string> = { "Message-ID": newMessageId };
  if (last.message_id) headers["In-Reply-To"] = last.message_id;
  if (refs) headers["References"] = refs;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [last.from_email], subject, text, html, headers }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Resend-fel:", res.status, err);
    return json({ error: "Kunde inte skicka via Resend" }, 502);
  }

  const { data: saved, error: sErr } = await db.from("inbox_messages").insert({
    thread_id: threadId,
    direction: "out",
    message_id: newMessageId,
    in_reply_to: last.message_id,
    refs: refs || null,
    from_email: "info@heavyvoices.se",
    from_name: sender.name,
    to_email: last.from_email,
    subject,
    text_body: `${message}\n\n${signature}`,
    is_read: true,
    sent_by: sender.id,
  }).select("id").single();
  if (sErr) console.error("Svaret skickades men kunde inte sparas:", sErr.message);

  // Svarad tråd ligger kvar i den mapp den låg i, men räknas som läst
  await db.from("inbox_messages").update({ is_read: true }).eq("thread_id", threadId);

  return json({ ok: true, id: saved?.id ?? null, to: last.from_email });
});
