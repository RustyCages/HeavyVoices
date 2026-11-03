// Delad R2-klient baserad på fetch (aws4fetch) i stället för AWS SDK:
// SDK:ns node:http-lager kraschar Deno-workern på tomma svar (HEAD/404).
import { AwsClient } from "npm:aws4fetch@1";

export const BUCKET = Deno.env.get("R2_BUCKET") ?? "";
const ENDPOINT = `https://${Deno.env.get("R2_ACCOUNT_ID") ?? ""}.r2.cloudflarestorage.com`;

const aws = new AwsClient({
  accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
  secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "",
  service: "s3",
  region: "auto",
});

const enc = (key: string) => key.split("/").map(encodeURIComponent).join("/");
const objUrl = (key: string) => new URL(`${ENDPOINT}/${BUCKET}/${enc(key)}`);
const xml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Storlek i byte, eller null om objektet saknas */
export async function head(key: string): Promise<number | null> {
  const r = await aws.fetch(objUrl(key), { method: "HEAD" });
  return r.ok ? Number(r.headers.get("content-length")) : null;
}

export async function put(key: string, body: BodyInit, contentType: string) {
  const r = await aws.fetch(objUrl(key), {
    method: "PUT", body, headers: { "Content-Type": contentType },
  });
  if (!r.ok) throw new Error(`R2 PUT ${r.status}: ${await r.text()}`);
}

export async function del(key: string) {
  const r = await aws.fetch(objUrl(key), { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(`R2 DELETE ${r.status}: ${await r.text()}`);
}

export async function presign(
  key: string, method: "GET" | "PUT", ttl: number, query: Record<string, string> = {},
): Promise<string> {
  const u = objUrl(key);
  u.searchParams.set("X-Amz-Expires", String(ttl));
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  const signed = await aws.sign(new Request(u, { method }), { aws: { signQuery: true } });
  return signed.url;
}

export type R2Object = { key: string; size: number; updated: string };

export async function list(prefix: string, delimiter?: string) {
  const objects: R2Object[] = [];
  const prefixes: string[] = [];
  let token: string | undefined;

  do {
    const u = new URL(`${ENDPOINT}/${BUCKET}`);
    u.searchParams.set("list-type", "2");
    u.searchParams.set("prefix", prefix);
    if (delimiter) u.searchParams.set("delimiter", delimiter);
    if (token) u.searchParams.set("continuation-token", token);

    const r = await aws.fetch(u);
    const body = await r.text();
    if (!r.ok) throw new Error(`R2 LIST ${r.status}: ${body}`);

    for (const m of body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const c = m[1];
      objects.push({
        key: xml(c.match(/<Key>([\s\S]*?)<\/Key>/)?.[1] ?? ""),
        size: Number(c.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        updated: c.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? "",
      });
    }
    for (const m of body.matchAll(/<CommonPrefixes>\s*<Prefix>([\s\S]*?)<\/Prefix>/g)) {
      prefixes.push(xml(m[1]));
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(body)
      ? xml(body.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? "")
      : undefined;
  } while (token);

  return { objects, prefixes };
}
