// youtube-channel
// Bläddra i en YouTube-kanals videor (anropas från medlem/uppvarmning.html).
// Tillgänglig för alla godkända medlemmar (admin kan dessutom lägga till videor på sidan).
// Body: { channel_id?: string (UC...), page_token?: string }
// Svar: { videos: [{ id, title, published }], next_page_token: string | null, source: "api" | "rss" }
//
// Med secret YOUTUBE_API_KEY (YouTube Data API v3) hämtas hela arkivet, 50 i taget med sidnumrering.
// Utan nyckel används kanalens RSS-flöde (de 15 senaste videorna, ingen sidnumrering).
// SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.

import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_CHANNEL = "UCbAHuHgj0RjadzpDzZ0OWVA"; // Aussie Vocal Coach

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

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // --- Endast inloggad, godkänd medlem eller admin ---
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Ogiltig inloggning" }, 401);
  const { data: me } = await admin
    .from("members")
    .select("role, status")
    .eq("id", userData.user.id)
    .single();
  if (!me || !["admin", "medlem"].includes(me.role) || me.status !== "approved") {
    return json({ error: "Endast godkända medlemmar" }, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* tom body är ok */ }
  const channelId = String(body?.channel_id ?? DEFAULT_CHANNEL).trim();
  if (!/^UC[\w-]{22}$/.test(channelId)) return json({ error: "Ogiltigt kanal-ID" }, 400);
  const pageToken = body?.page_token ? String(body.page_token) : "";

  const key = Deno.env.get("YOUTUBE_API_KEY");

  try {
    if (key) {
      const uploads = "UU" + channelId.slice(2); // kanalens uppladdningsspellista
      const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
      url.searchParams.set("part", "snippet");
      url.searchParams.set("maxResults", "50");
      url.searchParams.set("playlistId", uploads);
      url.searchParams.set("key", key);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        console.error("YouTube API-fel:", res.status, JSON.stringify(data));
        return json({ error: data?.error?.message || `YouTube API-fel ${res.status}` }, 502);
      }
      const videos = (data.items ?? [])
        .map((it: any) => ({
          id: it?.snippet?.resourceId?.videoId,
          title: String(it?.snippet?.title ?? ""),
          published: it?.snippet?.publishedAt ?? null,
        }))
        .filter((v: any) => v.id && !/^(Private video|Deleted video)$/i.test(v.title));
      return json({ videos, next_page_token: data.nextPageToken ?? null, source: "api" });
    }

    // Utan API-nyckel: RSS (15 senaste)
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (!res.ok) return json({ error: `Kunde inte hämta kanalens flöde (${res.status})` }, 502);
    const xml = await res.text();
    const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
      const e = m[1];
      return {
        id: e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/)?.[1],
        title: decodeXml(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ""),
        published: e.match(/<published>([^<]+)<\/published>/)?.[1] ?? null,
      };
    }).filter((v) => v.id);
    return json({ videos, next_page_token: null, source: "rss" });
  } catch (e) {
    console.error("youtube-channel fel:", e);
    return json({ error: "Kunde inte nå YouTube" }, 502);
  }
});
