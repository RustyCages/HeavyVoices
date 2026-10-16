// r2-migrate — engångskopiering Supabase Storage → R2 (admin-only, körs i batchar)
// Anrop: { bucket: "heavy-voices-stems", offset: 0, limit: 10 }
// Svar:  { total, copied, skipped, failed, next } — fortsätt med offset = next tills next = null
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { BUCKET, head, put } from "./r2.ts";

const ALLOWED: Record<string, string> = {
  "heavy-voices-stems": "stems",
  "heavy-voices-warmup": "warmup",
  "heavy-voices-filer": "filer",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

type Obj = { name: string; size: number; type: string };

// deno-lint-ignore no-explicit-any
async function listRecursive(storage: any, bucket: string, prefix = ""): Promise<Obj[]> {
  const out: Obj[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await storage.from(bucket).list(prefix, {
      limit: 1000, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const it of data ?? []) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) {
        out.push(...await listRecursive(storage, bucket, path));
      } else if (it.name !== ".emptyFolderPlaceholder") {
        out.push({
          name: path,
          size: Number(it.metadata?.size ?? -1),
          type: it.metadata?.mimetype ?? "application/octet-stream",
        });
      }
    }
    if ((data?.length ?? 0) < 1000) break;
    offset += 1000;
  }
  return out;
}

const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  const { supabase, supabaseAdmin, userClaims } = ctx;
  try {
    if (!BUCKET) return json({ error: "R2-secrets saknas" }, 503);

    const { data: caller } = await supabase
      .from("members").select("role").eq("id", userClaims!.id).single();
    if (caller?.role !== "admin") return json({ error: "Kräver admin-behörighet" }, 403);

    const { bucket, offset = 0, limit = 10 } = await req.json();
    const area = ALLOWED[bucket];
    if (!area) return json({ error: "Okänd bucket" }, 400);

    const all = await listRecursive(supabaseAdmin.storage, bucket);
    const batch = all.slice(offset, offset + limit);

    let copied = 0, skipped = 0;
    const failed: { name: string; error: string }[] = [];

    for (const o of batch) {
      const key = `${area}/${o.name}`;
      try {
        if ((await head(key)) === o.size) { skipped++; continue; }
        const { data: blob, error } = await supabaseAdmin.storage.from(bucket).download(o.name);
        if (error || !blob) throw new Error(error?.message ?? "download misslyckades");
        await put(key, await blob.arrayBuffer(), o.type);
        copied++;
      } catch (e) {
        failed.push({ name: o.name, error: (e as Error).message });
      }
    }

    const next = offset + limit < all.length ? offset + limit : null;
    return json({ bucket, total: all.length, copied, skipped, failed, next });
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
