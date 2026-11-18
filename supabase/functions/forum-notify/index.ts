// forum-notify
// Mejlnotis när någon svarar på ett forumämne. Anropas från medlem/forum.html direkt efter att svaret sparats.
// Body: { post_id: string }  (id på svaret)
//
// Mottagare: bara de som FÖLJER tråden (tabellen forum_follows), aldrig den som svarade.
// Dessutom måste mottagaren få se tråden (synlighet 'alla' / 'korledning' / 'valda') och vara aktiv medlem.
// Varje svar notifieras högst en gång (forum_posts.notified_at).
//
// Secrets: RESEND_API_KEY. SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.

import { createClient } from "npm:@supabase/supabase-js@2";

const FROM = "Heavy Voices <info@heavyvoices.se>";
const LOGO_URL = "https://heavyvoices.se/icons/logo-large.png";
const FORUM_URL = "https://heavyvoices.se/medlem/forum.html";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: u, error: ue } = await db.auth.getUser(token);
  if (ue || !u?.user) return json({ error: "Ogiltig inloggning" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }
  const postId = String(body?.post_id ?? "");
  if (!postId) return json({ error: "post_id saknas" }, 400);

  // Svaret måste vara skrivet av den som anropar, och inte redan notifierat
  const { data: reply } = await db.from("forum_posts")
    .select("id, parent_id, author_id, body, notified_at, author:members!forum_posts_author_id_fkey(name)")
    .eq("id", postId).maybeSingle();
  if (!reply || !reply.parent_id) return json({ error: "Svaret hittades inte" }, 404);
  if (reply.author_id !== u.user.id) return json({ error: "Inte ditt svar" }, 403);
  if (reply.notified_at) return json({ sent: 0, already: true });

  // Markera först så att dubbla anrop inte ger dubbla mejl
  const { data: claimed } = await db.from("forum_posts")
    .update({ notified_at: new Date().toISOString() }).eq("id", postId).is("notified_at", null).select("id");
  if (!claimed?.length) return json({ sent: 0, already: true });

  const { data: thread } = await db.from("forum_posts")
    .select("id, author_id, title, visibility, recipients").eq("id", reply.parent_id).maybeSingle();
  if (!thread) return json({ error: "Tråden hittades inte" }, 404);

  // Bara följare av tråden
  const { data: followers } = await db.from("forum_follows").select("user_id").eq("thread_id", thread.id);
  const ids = new Set<string>((followers ?? []).map((r: any) => r.user_id));
  ids.delete(reply.author_id);
  if (!ids.size) return json({ sent: 0 });

  const nowIso = new Date().toISOString();
  const { data: members } = await db.from("members").select("id, name, email, role, stamledare, status, access_until")
    .in("id", [...ids]).eq("status", "approved").not("email", "is", null)
    .or(`access_until.is.null,access_until.gt.${nowIso}`);
  let list = (members ?? []).filter((m: any) => m.email);
  // Följare som inte (längre) får se tråden får inget mejl
  if (thread.visibility === "korledning") {
    list = list.filter((m: any) => m.id === thread.author_id || m.role === "admin" || m.stamledare);
  } else if (thread.visibility === "valda") {
    const valda = new Set<string>([thread.author_id, ...(thread.recipients ?? [])]);
    list = list.filter((m: any) => valda.has(m.id));
  }
  if (!list.length) return json({ sent: 0 });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY saknas" }, 500);

  const who = (reply as any).author?.name || "Någon";
  const title = thread.title || "forumet";
  let quote = String(reply.body ?? "").trim();
  if (quote.length > 600) quote = quote.slice(0, 600).trimEnd() + "…";
  const quoteHtml = esc(quote).replace(/\n/g, "<br>");

  const emails = list.map((m: any) => {
    const first = String(m.name ?? "").trim().split(/\s+/)[0];
    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#121418;margin:0;padding:32px 20px;color:#f3f4f6;">
      <div style="max-width:680px;margin:0 auto;">
        <div style="text-align:center;margin:0 0 26px;padding-bottom:22px;border-bottom:1px solid #2a2f3a;">
          <img src="${LOGO_URL}" alt="HEAVY VOICES" width="180" style="display:block;margin:0 auto;width:180px;max-width:100%;height:auto;border:0;">
        </div>
        <div style="font-size:15px;">
          <p style="margin:0 0 14px;line-height:1.55;">${first ? "Hej " + esc(first) + "!" : "Hej!"}</p>
          <p style="margin:0 0 14px;line-height:1.55;"><b>${esc(who)}</b> har svarat i forumtråden <b>${esc(title)}</b>:</p>
          <div style="margin:0 0 18px;padding:12px 16px;border-left:3px solid #E5A968;background:#1a1d24;line-height:1.55;color:#e5e7eb;">${quoteHtml}</div>
          <p style="margin:0 0 6px;"><a href="${FORUM_URL}" style="display:inline-block;background:#E5A968;color:#111317;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px;">Öppna forumet</a></p>
        </div>
        <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #2a2f3a;font-size:12px;color:#6b7280;">Du får det här mejlet eftersom du följer tråden. Sluta följa genom att trycka på "Du följer tråden" i forumet.</p>
      </div>
    </div>`;
    return {
      from: FROM,
      to: [m.email],
      subject: `Nytt svar i forumet: ${title}`,
      html,
      text: `${who} har svarat i forumtråden "${title}":\n\n${quote}\n\nÖppna forumet: ${FORUM_URL}\n\nDu får det här mejlet eftersom du följer tråden.\n`,
    };
  });

  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(emails),
  });
  if (!res.ok) {
    console.error("Resend-fel:", res.status, await res.text());
    return json({ error: "Kunde inte skicka" }, 502);
  }
  return json({ sent: emails.length });
});
