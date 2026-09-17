// Fyll i efter att Supabase-projektet är skapat
const SUPABASE_URL = 'https://scfudeyozwedohujsoua.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lQf4A7LCOH42d_Di-B7oiw_1JzB_2sh';

// Laddas via CDN i HTML (se index.html) — ingen bundler
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
 
