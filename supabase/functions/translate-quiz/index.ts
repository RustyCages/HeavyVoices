// translate-quiz
// Översätter engelska quizfrågor (Open Trivia DB, The Trivia API, rockfrågor) till svenska med DeepL.
// Varje fråga översätts bara EN gång – resultatet sparas i tabellen quiz_translations och återanvänds.
//
// Body:    { items: [{ q, correct, wrong: string[], cat?, src?, keepAnswers? }] }   (max 120 st)
// Svar:    { items: [ { q, correct, wrong, h, blocked? } | null ] }   i samma ordning som indata
//          null = kunde inte översättas → klienten visar engelska.  { error, code } vid fel.
// Secrets: DEEPL_API_KEY  (DeepL API Free slutar på ":fx" → api-free.deepl.com, annars api.deepl.com)
// Behörighet: admin/stämledare alltid, medlemmar när party_settings.members_enabled = true.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Frågor som bygger på det engelska språket fungerar inte översatta
const LANG_BOUND = /\b(rhym\w*|spell\w*|letters?|anagram|abbreviat\w*|acronym|stands? for|pronounc\w*|in english|english word|word (for|that|which)|plural|synonym|homophone|palindrome|initials)\b/i;
// Svar som aldrig ska översättas: siffror, årtal, procent, enskilda bokstäver
const NUMERIC = /^[\d\s.,:%°\-–+/]+$|^[A-Z]$/;
// Titel-skrivna svar (band, låtar, album) behålls i musikkategorier
const TITLE_CASE = (s: string) => s.split(/\s+/).every((w) => /^[^a-zåäö]/u.test(w) || /^(of|the|and|a|an|in|on|to|for|n'|&)$/i.test(w));

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const keyOf = (it: any) => `${it.q}|${it.correct}|${[...(it.wrong || [])].sort().join("|")}`;

async function deepl(key: string, texts: string[]): Promise<string[]> {
  const host = key.trim().endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
  const out: string[] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const chunk = texts.slice(i, i + 50);
    const res = await fetch(`https://${host}/v2/translate`, {
      method: "POST",
      headers: { "Authorization": `DeepL-Auth-Key ${key.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: chunk, source_lang: "EN", target_lang: "SV",
        tag_handling: "xml", ignore_tags: ["x"], splitting_tags: ["q", "a"], outline_detection: false,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw Object.assign(new Error(res.status === 456 ? "DeepL-kvoten för månaden är slut" : res.status === 403 ? "DeepL-nyckeln är ogiltig" : `DeepL svarade ${res.status} ${t.slice(0, 120)}`), { code: res.status === 456 ? "quota" : res.status === 403 ? "bad_key" : "deepl_error" });
    }
    const data = await res.json();
    for (const t of data.translations || []) out.push(String(t.text || ""));
  }
  return out;
}
// En fråga skickas som ETT XML-dokument så att DeepL ser frågan när svaren översätts
// ("Turkey" blir Turkiet, inte kalkon). Svar som ska behållas ligger i <x> och översätts inte.
const xesc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const xun = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
function parseDoc(doc: string) {
  const q = (doc.match(/<q>([\s\S]*?)<\/q>/) || [])[1] ?? "";
  const ans = [...doc.matchAll(/<a>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
  return { q: untag(xun(q)), ans: ans.map((a) => untag(xun(a))) };
}
// <x>…</x> skyddar namn i frågan (klienten kan markera dem) – ta bort taggarna efteråt
const untag = (s: string) => s.replace(/<\/?x>/g, "").replace(/\s+/g, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inte inloggad" }, 401);
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return json({ error: "Ogiltig inloggning" }, 401);
  const { data: me } = await admin.from("members").select("role, status, stamledare").eq("id", u.user.id).single();
  if (!me || me.status !== "approved") return json({ error: "Inte godkänd medlem" }, 403);
  if (me.role !== "admin" && !me.stamledare) {
    const { data: s } = await admin.from("party_settings").select("members_enabled").eq("id", 1).maybeSingle();
    if (!s?.members_enabled) return json({ error: "Party Mode är inte öppnat för medlemmar" }, 403);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Ogiltig JSON" }, 400); }
  const items: any[] = (Array.isArray(body?.items) ? body.items : []).slice(0, 120).map((it: any) => ({
    q: String(it?.q ?? "").slice(0, 500).trim(),
    correct: String(it?.correct ?? "").slice(0, 200).trim(),
    wrong: (Array.isArray(it?.wrong) ? it.wrong : []).slice(0, 5).map((w: any) => String(w ?? "").slice(0, 200).trim()),
    cat: String(it?.cat ?? "").slice(0, 40),
    src: String(it?.src ?? "otdb").slice(0, 20),
    keepAnswers: it?.keepAnswers === true,
  }));
  if (!items.length) return json({ items: [] });

  const hashes = await Promise.all(items.map((it) => sha(keyOf(it))));
  const result: any[] = new Array(items.length).fill(null);
  // h = frågans nyckel i quiz_translations (används för att spärra en dålig fråga)
  const done = (extra: Record<string, unknown> = {}) =>
    json({ items: result.map((r, i) => r ? { ...r, h: hashes[i] } : null), ...extra });

  // 1. Redan översatta
  const { data: cached } = await admin.from("quiz_translations")
    .select("source_hash, question_sv, correct_sv, wrong_sv, blocked").in("source_hash", [...new Set(hashes)]);
  const byHash = new Map((cached || []).map((r: any) => [r.source_hash, r]));
  const todo: number[] = [];
  items.forEach((it, i) => {
    const r: any = byHash.get(hashes[i]);
    if (r) result[i] = r.blocked ? { blocked: true } : { q: r.question_sv, correct: r.correct_sv, wrong: r.wrong_sv || [] };
    else if (!it.q || !it.correct) result[i] = null;
    else todo.push(i);
  });
  if (!todo.length) return done({ cached: items.length });

  const key = Deno.env.get("DEEPL_API_KEY");
  if (!key) return done({ error: "DEEPL_API_KEY saknas", code: "no_key" });

  // 2. Ett XML-dokument per fråga. Svar som ska behållas läggs i <x> (översätts inte).
  const texts: string[] = [];
  const plan = new Map<number, { doc: number; blocked: boolean }>();
  const seen = new Set<string>();
  for (const i of todo) {
    const it = items[i];
    if (seen.has(hashes[i])) continue; // samma fråga två gånger i batchen
    seen.add(hashes[i]);
    if (LANG_BOUND.test(it.q)) { plan.set(i, { doc: -1, blocked: true }); continue; }
    const music = it.keepAnswers || /music|rock|musik/i.test(it.cat) || it.src === "rock";
    const ans = [it.correct, ...it.wrong].map((a) =>
      (NUMERIC.test(a) || (music && TITLE_CASE(a))) ? `<a><x>${xesc(a)}</x></a>` : `<a>${xesc(a)}</a>`);
    plan.set(i, { doc: texts.push(`<r><q>${xesc(it.q)}</q>${ans.join("")}</r>`) - 1, blocked: false });
  }

  let tr: string[] = [];
  try { tr = texts.length ? await deepl(key, texts) : []; }
  catch (e: any) { return done({ error: e.message, code: e.code || "deepl_error" }); }

  // 3. Spara och svara
  const rows: any[] = [];
  for (const [i, p] of plan) {
    const it = items[i];
    if (p.blocked) {
      rows.push({ source: it.src, source_hash: hashes[i], question_en: it.q, question_sv: it.q, correct_sv: it.correct, wrong_sv: it.wrong, category: it.cat || null, blocked: true });
      continue;
    }
    const { q, ans: parsed } = parseDoc(tr[p.doc] ?? "");
    const orig = [it.correct, ...it.wrong];
    const ans = orig.map((a, k) => parsed[k] || "");
    if (!q || parsed.length !== orig.length || ans.some((a) => !a)) continue; // trasigt svar från DeepL – spara inte, visa engelska
    const [correct, ...wrong] = ans;
    // Om två alternativ blev likadana efter översättningen går frågan inte att använda
    const uniq = new Set(ans.map((a) => a.toLowerCase()));
    const blocked = uniq.size !== ans.length;
    rows.push({ source: it.src, source_hash: hashes[i], question_en: it.q, question_sv: q || it.q, correct_sv: correct || it.correct, wrong_sv: wrong, category: it.cat || null, blocked });
  }
  if (rows.length) await admin.from("quiz_translations").upsert(rows, { onConflict: "source_hash", ignoreDuplicates: true });
  const byNew = new Map(rows.map((r) => [r.source_hash, r]));
  for (const i of todo) {
    const r: any = byNew.get(hashes[i]);
    result[i] = !r ? null : r.blocked ? { blocked: true } : { q: r.question_sv, correct: r.correct_sv, wrong: r.wrong_sv };
  }
  return done({ translated: rows.length, chars: texts.reduce((n, t) => n + t.length, 0) });
});
