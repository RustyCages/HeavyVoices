// usdb-search
// Sök och hämta UltraStar-filer (.txt) från USDB (usdb.animux.de) åt admin i Röstövning.
// USDB kräver inloggning och skickar inga CORS-huvuden, så webbläsaren kan inte prata
// direkt med sajten – den här funktionen loggar in med körens USDB-konto och skickar vidare.
//
// Body: { action: "search", artist?: string, title?: string }
//       { action: "get", id: number }
// Secrets: USDB_USER, USDB_PASS (ett vanligt, gratis USDB-konto).

import { createClient } from "npm:@supabase/supabase-js@2";

const BASE = "https://usdb.animux.de/";
const UA = "HeavyVoices/1.0 (+https://heavyvoices.se)";
const NOT_LOGGED_IN = "You are not logged in";
const LOGIN_INVALID = "Login or Password invalid";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- USDB-session (cookies sparas mellan anrop så länge instansen lever) ----------
let cookieJar: Record<string, string> = {};
const cookieHeader = () => Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ");
function keepCookies(res: Response) {
  const list = (res.headers as any).getSetCookie?.() ?? [];
  for (const c of list) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) cookieJar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}
async function usdb(params: Record<string, string>, form?: Record<string, string>): Promise<string> {
  const url = BASE + "index.php?" + new URLSearchParams(params);
  const res = await fetch(url, {
    method: form ? "POST" : "GET",
    headers: {
      "User-Agent": UA,
      Cookie: cookieHeader(),
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
    redirect: "manual",
  });
  keepCookies(res);
  if (res.status >= 300 && res.status < 400) return "";
  if (!res.ok) throw new Error(`USDB svarade ${res.status}`);
  return await res.text();
}
async function login() {
  const user = Deno.env.get("USDB_USER"), pass = Deno.env.get("USDB_PASS");
  if (!user || !pass) throw new Error("USDB-konto saknas: lägg in USDB_USER och USDB_PASS som secrets i Supabase");
  cookieJar = {};
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user, pass, login: "Login" }),
    redirect: "manual",
  });
  keepCookies(res);
  const text = res.status < 300 ? await res.text() : "";
  if (text.includes(LOGIN_INVALID)) throw new Error("USDB-inloggningen misslyckades – kontrollera USDB_USER/USDB_PASS");
}
async function usdbAuthed(params: Record<string, string>, form?: Record<string, string>) {
  if (!Object.keys(cookieJar).length) await login();
  let html = await usdb(params, form);
  if (!html || html.includes(NOT_LOGGED_IN)) { await login(); html = await usdb(params, form); }
  if (html.includes(NOT_LOGGED_IN)) throw new Error("Kunde inte logga in på USDB");
  return html;
}

// ---------- tolkning ----------
const unescape = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const text = (s: string) => unescape(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

function parseList(html: string) {
  const out: any[] = [];
  const rowRe = /<tr class="list_tr\d"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const row = m[0];
    const id = (row.match(/data-songid="(\d+)"/) || row.match(/link=detail&(?:amp;)?id=(\d+)/) || [])[1];
    if (!id) continue;
    const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    // Kolumner (details=1): ljudprov, omslag, artist, titel, genre, år, utgåva, guldnoter, språk, skapare, betyg, visningar
    const ti = tds.findIndex((t) => /link=detail/.test(t));
    const artist = ti > 0 ? text(tds[ti - 1]) : "";
    const title = ti >= 0 ? text(tds[ti]) : "";
    const col = (k: number) => (ti >= 0 && tds[ti + k] != null ? text(tds[ti + k]) : "");
    const stars = ti >= 0 && tds[ti + 7] ? (tds[ti + 7].match(/star\.png|star_full/g) || []).length : 0;
    out.push({
      id: +id, artist, title,
      genre: col(1), year: col(2), edition: col(3), golden: col(4) === "Yes" || col(4) === "Ja",
      language: col(5), creator: col(6), rating: stars || null, views: +col(8).replace(/\D/g, "") || null,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // --- bara godkänd admin ---
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return json({ error: "Ogiltig inloggning" }, 401);
  const { data: me } = await admin.from("members").select("role, status").eq("id", u.user.id).single();
  if (!me || me.role !== "admin" || me.status !== "approved") return json({ error: "Endast admin" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }

  try {
    if (body?.action === "search") {
      const artist = String(body.artist ?? "").trim().slice(0, 100);
      const title = String(body.title ?? "").trim().slice(0, 100);
      if (!artist && !title) return json({ error: "Skriv artist eller titel" }, 400);
      const html = await usdbAuthed({ link: "list" }, {
        interpret: artist, title, edition: "", language: "", genre: "", user: "",
        order: "", ud: "", limit: "50", start: "0", details: "1",
      });
      return json({ results: parseList(html) });
    }
    if (body?.action === "get") {
      const id = Math.trunc(Number(body.id));
      if (!(id > 0)) return json({ error: "Ogiltigt id" }, 400);
      const html = await usdbAuthed({ link: "gettxt", id: String(id) }, { wd: "1" });
      const ta = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
      if (!ta) return json({ error: "Hittade ingen UltraStar-text för den låten" }, 404);
      return json({ id, txt: unescape(ta[1]).replace(/\r\n?/g, "\n") });
    }
    return json({ error: "Okänd action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || String(e) }, 502);
  }
});
