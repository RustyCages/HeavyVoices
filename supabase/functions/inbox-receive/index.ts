// inbox-receive
// Sparar ett rått mejl (RFC 822) till info@ i inkorgen (tabell inbox_messages, bilagor i R2 under
// inbox/<meddelande-id>/…). Bara admin ser inkorgen (RLS).
//
// Kedjan: Cloudflare Email Worker → forward-info-mail (vidarebefordrar till admins) → inbox-receive (sparar).
// Anrop: POST med det råa mejlet som body och huvudet  x-webhook-secret: <FORWARD_SECRET>
// Ingen JWT – driftsätt med verify_jwt = false. Hemligheten är det enda skyddet.
//
// Secrets: FORWARD_SECRET (samma som forward-info-mail), R2_* (samma som r2-files).
// SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.

import { createClient } from "npm:@supabase/supabase-js@2";
import PostalMime from "npm:postal-mime@2";
import { put } from "./r2.ts";

const MAX_TEXT = 1_000_000;        // tecken, per text- och html-del
const MAX_ATTACHMENT = 25 * 1024 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Jämförelse i konstant tid, så att hemligheten inte kan gissas via svarstider
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// "Re: SV: Fwd: Ämne" → "ämne", för att hitta tråden när svarshuvudena saknas
const baseSubject = (s: string) =>
  s.replace(/^\s*((re|sv|vs|fw|fwd|vb|aw)\s*(\[\d+\])?\s*:\s*)+/i, "").trim().toLowerCase();

const safeName = (n: string) =>
  (n || "bilaga").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 120);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!safeEqual(req.headers.get("x-webhook-secret") ?? "", Deno.env.get("FORWARD_SECRET") ?? "")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const raw = new Uint8Array(await req.arrayBuffer());
  if (!raw.length) return json({ error: "Tomt mejl" }, 400);

  let email;
  try {
    email = await PostalMime.parse(raw);
  } catch (e) {
    return json({ error: "Kunde inte tolka mejlet: " + (e as Error).message }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const id = crypto.randomUUID();
  const messageId = email.messageId?.trim() || null;
  const inReplyTo = email.inReplyTo?.trim() || null;
  const refs = (email.references ?? "").trim() || null;
  const fromEmail = (email.from?.address ?? "").toLowerCase() || null;
  const subject = (email.subject ?? "").slice(0, 500);

  // Redan sparat (t.ex. om workern försökte igen)?
  if (messageId) {
    const { data: dup } = await db.from("inbox_messages").select("id").eq("message_id", messageId).maybeSingle();
    if (dup) return json({ ok: true, duplicate: true });
  }

  // --- Tråd: via In-Reply-To/References, annars samma ämne till/från samma adress senaste 60 dagarna ---
  let threadId: string | null = null;
  const kandidater = [inReplyTo, ...(refs ?? "").split(/\s+/)].filter(Boolean) as string[];
  if (kandidater.length) {
    const { data } = await db.from("inbox_messages").select("thread_id")
      .in("message_id", kandidater).order("created_at", { ascending: false }).limit(1);
    threadId = data?.[0]?.thread_id ?? null;
  }
  // Adressen hamnar i ett PostgREST-filter, så bara vanliga adresstecken släpps igenom
  const filterbar = !!fromEmail && /^[a-z0-9._%+-]+@[a-z0-9.-]+$/.test(fromEmail);
  if (!threadId && filterbar && subject && /^\s*(re|sv|vs|aw)\s*:/i.test(subject)) {
    const since = new Date(Date.now() - 60 * 864e5).toISOString();
    const { data } = await db.from("inbox_messages").select("thread_id, subject")
      .or(`from_email.eq.${fromEmail},to_email.ilike.%${fromEmail}%`)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(50);
    const hit = (data ?? []).find((r) => baseSubject(r.subject ?? "") === baseSubject(subject));
    threadId = hit?.thread_id ?? null;
  }

  // --- Bilagor till R2 ---
  const attachments: { path: string; name: string; size: number; type: string; cid?: string }[] = [];
  for (const [i, a] of (email.attachments ?? []).entries()) {
    const bytes = typeof a.content === "string"
      ? new TextEncoder().encode(a.content)
      : new Uint8Array(a.content as ArrayBuffer);
    if (bytes.byteLength > MAX_ATTACHMENT) continue;
    const name = safeName(a.filename ?? `bilaga-${i + 1}`);
    const path = `${id}/${i + 1}-${name}`;
    const type = a.mimeType || "application/octet-stream";
    try {
      await put(`inbox/${path}`, bytes, type);
      const cid = a.contentId ? a.contentId.replace(/^<|>$/g, "") : undefined;
      attachments.push({ path, name: a.filename || name, size: bytes.byteLength, type, ...(cid ? { cid } : {}) });
    } catch (e) {
      console.error("Bilaga kunde inte sparas", name, (e as Error).message);
    }
  }

  const addr = (list?: { address?: string; name?: string }[]) =>
    (list ?? []).map((x) => (x.name ? `${x.name} <${x.address}>` : x.address)).filter(Boolean).join(", ") || null;

  const { error } = await db.from("inbox_messages").insert({
    id,
    thread_id: threadId ?? id,
    direction: "in",
    message_id: messageId,
    in_reply_to: inReplyTo,
    refs,
    from_email: fromEmail,
    from_name: email.from?.name || null,
    to_email: addr(email.to),
    cc: addr(email.cc),
    subject: subject || null,
    text_body: email.text ? email.text.slice(0, MAX_TEXT) : null,
    html_body: email.html ? email.html.slice(0, MAX_TEXT) : null,
    attachments,
  });
  if (error) {
    if (error.code === "23505") return json({ ok: true, duplicate: true });
    console.error("Insert misslyckades", error.message);
    return json({ error: error.message }, 500);
  }

  return json({ ok: true, id });
});
