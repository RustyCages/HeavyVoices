// r2-files — presigned URLs + listing/radering mot Cloudflare R2
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//
// En bucket i R2, ett prefix per område. Sökvägarna i databasen ändras inte:
//   songs.stem_*_path, bg_video_path        → area "stems"   → R2-nyckel "stems/<path>"
//   warmup_videos.video_path / thumb_path   → area "warmup"  → R2-nyckel "warmup/<path>"
//   filutforskaren                          → area "filer"   → R2-nyckel "filer/<path>"
//   forum_attachments.path                  → area "forum"   → R2-nyckel "forum/<path>"
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { BUCKET, del, list, presign, put } from "./r2.ts";

type Area = "stems" | "warmup" | "filer" | "forum";
type Action = "list" | "upload" | "download" | "sign" | "delete" | "mkdir";

interface Payload {
  action: Action;
  area: Area;
  key?: string;
  keys?: string[];
  prefix?: string;
  contentType?: string;
  download?: boolean;
  filename?: string;     // namn vid nedladdning (annars sista delen av sökvägen)
}

const AREAS: Area[] = ["stems", "warmup", "filer", "forum"];
// Speglar Storage-policyerna: stems = is_song_editor(), övriga = is_admin().
// forum: alla godkända kan ladda upp (i sin egen mapp), åtkomst till filen kontrolleras mot forum_attachments.
const canWrite = (area: Area, m: { role: string; stamledare: boolean }) =>
  area === "forum" || m.role === "admin" || (area === "stems" && m.stamledare === true);
const WRITE_ACTIONS: Action[] = ["upload", "delete", "mkdir"];
const PUT_TTL = 60 * 15;      // 15 min för uppladdning
const GET_TTL = 60 * 60 * 6;  // 6 h, så att <audio>/<video> klarar långa övningspass med seek

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

function toKey(area: Area, p: string | undefined, isFolder = false): string | null {
  if (p === undefined) return null;
  const parts = p.split("/").filter(Boolean);
  if (parts.some((s) => s === "." || s === "..")) return null;
  if (parts.length === 0) return isFolder ? `${area}/` : null;
  return `${area}/${parts.join("/")}${isFolder ? "/" : ""}`;
}

const signGet = (key: string, download = false, filename?: string) =>
  presign(key, "GET", GET_TTL, download
    ? { "response-content-disposition":
        `attachment; filename*=UTF-8''${encodeURIComponent(filename || key.split("/").pop()!)}` }
    : {});

const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  const { supabase, userClaims } = ctx;
  try {
    if (!BUCKET) return json({ error: "R2 är inte konfigurerat (secrets saknas)" }, 503);

    const { data: caller } = await supabase
      .from("members").select("role, status, stamledare").eq("id", userClaims!.id).single();
    if (!caller || caller.status !== "approved") {
      return json({ error: "Kontot är inte godkänt" }, 403);
    }

    const body: Payload = await req.json();
    const { action, area } = body;
    if (!AREAS.includes(area)) return json({ error: "Ogiltigt område" }, 400);
    if (WRITE_ACTIONS.includes(action) && !canWrite(area, caller)) {
      return json({ error: area === "stems" ? "Kräver admin eller stämledare" : "Kräver admin-behörighet" }, 403);
    }

    // Forum: bara uppladdning och nedladdning. Nedladdning släpps bara igenom för bilagor
    // som den inloggade själv får se enligt RLS (forum_attachments använder användarens egen klient).
    if (area === "forum") {
      if (action !== "upload" && action !== "download") {
        return json({ error: "Åtgärden stöds inte för forum" }, 400);
      }
      const key = toKey(area, body.key);
      if (!key) return json({ error: "key krävs" }, 400);
      const rel = key.slice(area.length + 1);
      if (action === "upload" && !/^[0-9a-f-]{36}\/[^/]+$/i.test(rel)) {
        return json({ error: "Ogiltig sökväg för forum" }, 400);
      }
      if (action === "download") {
        const { data: bilaga } = await supabase
          .from("forum_attachments").select("id").eq("path", rel).maybeSingle();
        if (!bilaga) return json({ error: "Filen finns inte eller saknar åtkomst" }, 403);
      }
    }

    switch (action) {
      case "list": {
        const prefix = toKey(area, body.prefix ?? "", true);
        if (!prefix) return json({ error: "Ogiltig sökväg" }, 400);
        const { objects, prefixes } = await list(prefix, "/");
        const strip = (k: string) => k.slice(area.length + 1);
        return json({
          prefix: strip(prefix),
          folders: prefixes.map(strip),
          files: objects
            .filter((o) => o.key !== prefix && !o.key.endsWith("/.keep"))
            .map((o) => ({ key: strip(o.key), name: o.key.slice(prefix.length), size: o.size, updated: o.updated })),
        });
      }

      case "upload": {
        const key = toKey(area, body.key);
        if (!key) return json({ error: "key krävs" }, 400);
        return json({ url: await presign(key, "PUT", PUT_TTL) });
      }

      case "download": {
        const key = toKey(area, body.key);
        if (!key) return json({ error: "key krävs" }, 400);
        return json({ url: await signGet(key, body.download, body.filename) });
      }

      case "sign": {
        const rel = (body.keys ?? []).filter(Boolean).slice(0, 50);
        const urls: Record<string, string> = {};
        await Promise.all(rel.map(async (p) => {
          const key = toKey(area, p);
          if (key) urls[p] = await signGet(key);
        }));
        return json({ urls });
      }

      case "mkdir": {
        const prefix = toKey(area, body.prefix, true);
        if (!prefix || prefix === `${area}/`) return json({ error: "prefix krävs" }, 400);
        await put(prefix + ".keep", new Uint8Array(0), "application/octet-stream");
        return json({ success: true });
      }

      case "delete": {
        const key = body.key ? toKey(area, body.key) : null;
        const prefix = body.prefix ? toKey(area, body.prefix, true) : null;
        if (!key && (!prefix || prefix === `${area}/`)) {
          return json({ error: "key eller prefix krävs" }, 400);
        }
        const keys = key ? [key] : (await list(prefix!)).objects.map((o) => o.key);
        for (let i = 0; i < keys.length; i += 10) {
          await Promise.all(keys.slice(i, i + 10).map(del));
        }
        return json({ success: true, deleted: keys.length });
      }

      default:
        return json({ error: "Okänd action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    return handler(req);
  },
};
