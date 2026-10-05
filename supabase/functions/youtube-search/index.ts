// youtube-search
// Söker karaokevideor på YouTube åt Party Mode (medlem/party.html).
// API-nyckeln får inte ligga i webbläsaren, så sökningen går via den här funktionen.
//
// Body:    { q: string }            ("karaoke" läggs till automatiskt om det saknas)
// Svar:    { items: [{ id, title, channel, thumb }] }   eller { error, code? }
// Secrets: YOUTUBE_API_KEY  (Google Cloud → YouTube Data API v3 → API-nyckel)
//
// Kvot: en sökning kostar 100 enheter av 10 000 gratis/dygn ≈ 100 sökningar per dygn.
// Behörighet: admin alltid, medlemmar bara när party_settings.members_enabled = true.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const decode = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return json({ error: "Ogiltig inloggning" }, 401);
  const { data: me } = await admin.from("members").select("role, status").eq("id", u.user.id).single();
  if (!me || me.status !== "approved") return json({ error: "Inte godkänd medlem" }, 403);
  if (me.role !== "admin") {
    const { data: s } = await admin.from("party_settings").select("members_enabled").eq("id", 1).maybeSingle();
    if (!s?.members_enabled) return json({ error: "Party Mode är inte öppnat för medlemmar" }, 403);
  }

  const key = Deno.env.get("YOUTUBE_API_KEY");
  if (!key) return json({ error: "YOUTUBE_API_KEY saknas", code: "no_key" }, 200);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }
  let q = String(body?.q ?? "").trim().slice(0, 120);
  if (!q) return json({ items: [] });
  if (!/karaoke|instrumental|backing/i.test(q)) q += " karaoke";

  const url = "https://www.googleapis.com/youtube/v3/search?" + new URLSearchParams({
    part: "snippet", type: "video", videoEmbeddable: "true", maxResults: "15",
    safeSearch: "none", q, key,
  });
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason || "";
    return json({ error: reason === "quotaExceeded" ? "Dagens YouTube-kvot är slut – försök igen i morgon" : (data?.error?.message || `YouTube svarade ${res.status}`), code: reason || "yt_error" }, 200);
  }
  const items = (data.items || []).filter((it: any) => it?.id?.videoId).map((it: any) => ({
    id: it.id.videoId,
    title: decode(it.snippet?.title || ""),
    channel: decode(it.snippet?.channelTitle || ""),
    thumb: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || "",
  }));
  return json({ items });
});
