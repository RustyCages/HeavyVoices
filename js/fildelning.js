// Fildelning – filutforskare med delning (som Google Drive).
// Används av admin/info.html och medlem/info.html:  Fildelning.mount(elementet, member)
//
// Regler (upprätthålls av RLS, se supabase/migrations/2026-11-23_fildelning_mappar.sql):
//   * Admin och stämledare laddar upp och skapar mappar – bara i egna mappar.
//   * En fil syns för uppladdaren, för dem den delats med (direkt eller via en mapp ovanför) och för admin.
//   * Bara uppladdaren delar och ändrar delning. Radera: uppladdaren eller admin.
// Mapparna finns bara i databasen (shared_folders); objekten i bucketen flyttas aldrig.
(function () {
  const BUCKET = 'heavy-voices-fildelning';
  const OFFICE_EXT = /\.(docx?|xlsx?|pptx?)$/i;
  const TARGET_LABEL = { alla: 'Alla aktiva', korledning: 'Körledningen' };

  const esc = s => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtSize = b => b == null ? '' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const safeName = n => n.normalize('NFC').replace(/[^A-Za-z0-9._-]/g, '_');
  const byName = (a, b) => a.name.localeCompare(b.name, 'sv');
  const say = (msg, ms) => (typeof window.toast === 'function' ? window.toast(msg, ms) : alert(msg));

  const ICON = {
    folder: '<svg class="file-icon folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    file: '<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    rename: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    move: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M10 13h6"/><path d="m13 10 3 3-3 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
  };

  const CSS = `
  .fd-tabs { display:flex; gap:0.5rem; flex-wrap:wrap; margin-bottom:1rem; }
  .fd-tabs .tab-btn { background:rgba(255,255,255,0.06); color:#d1d5db; border:1px solid rgba(255,255,255,0.12); padding:0.5rem 1rem; }
  .fd-tabs .tab-btn.active { background:var(--accent); color:#111317; }
  .fd-toolbar { display:flex; gap:0.6rem; flex-wrap:wrap; margin-bottom:1rem; }
  .fd-crumbs { display:flex; align-items:center; flex-wrap:wrap; gap:0.35rem; margin-bottom:1rem; font-family:'Roboto Condensed', sans-serif; }
  .fd-crumbs a { color:var(--accent); cursor:pointer; }
  .fd-crumbs .sep { color:var(--text-muted); }
  .fd-crumbs .crumb-back { font-family:inherit; font-size:0.85rem; padding:0.3rem 0.7rem; margin-right:0.3rem; }
  .fd-badge { display:inline-block; font-size:0.72rem; padding:0.1rem 0.5rem; border-radius:1rem; border:1px solid var(--border); color:var(--text-muted); margin-left:0.4rem; white-space:nowrap; vertical-align:middle; }
  .fd-badge.on { border-color:var(--accent); color:var(--accent); }
  .fd-modal-bg { position:fixed; inset:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:1000; padding:1rem; }
  .fd-modal { background:var(--bg); border:1px solid var(--border); border-radius:0.8rem; width:100%; max-width:480px; max-height:88vh; display:flex; flex-direction:column; box-shadow:var(--card-shadow); }
  .fd-modal h3 { margin:0; padding:1rem 1.2rem 0.2rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fd-modal .fd-body { overflow-y:auto; padding:0.4rem 1.2rem 0.8rem; display:flex; flex-direction:column; gap:0.8rem; }
  .fd-modal .fd-sub { font-size:0.85rem; color:var(--text-muted); margin:0; }
  .fd-modal h4 { margin:0.3rem 0 0; font-size:0.95rem; }
  .fd-chips { display:flex; flex-wrap:wrap; gap:0.4rem; }
  .fd-chip { display:inline-flex; align-items:center; gap:0.35rem; padding:0.3rem 0.4rem 0.3rem 0.7rem; border-radius:1rem; background:rgba(229,169,104,0.12); border:1px solid rgba(229,169,104,0.4); font-size:0.85rem; }
  .fd-chip button { background:none; border:none; color:var(--text-muted); padding:0 0.3rem; font-size:1rem; line-height:1; cursor:pointer; min-width:0; }
  .fd-chip button:hover { color:#ef4444; background:none; }
  .fd-chips .btn-outline { padding:0.35rem 0.8rem; font-size:0.85rem; }
  .fd-members { max-height:240px; overflow-y:auto; border:1px solid var(--border); border-radius:0.5rem; padding:0.2rem 0.6rem; }
  .fd-members label { display:flex; align-items:center; justify-content:flex-start; gap:0.6rem; padding:0.35rem 0; margin:0; cursor:pointer; text-align:left; }
  .fd-members input[type=checkbox] { width:auto; min-width:0; margin:0; flex:none; }
  .fd-members label span { flex:1; }
  .fd-members label[hidden] { display:none; }
  .fd-members small { color:var(--text-muted); }
  .fd-modal .fd-actions { display:flex; justify-content:flex-end; gap:0.5rem; padding:0.8rem 1.2rem; border-top:1px solid var(--border); }
  .fd-pick { display:flex; align-items:center; gap:0.5rem; width:100%; background:none; color:var(--text); border:none; border-radius:0.4rem; padding:0.5rem 0.6rem; text-align:left; font-weight:400; cursor:pointer; }
  .fd-pick:hover:not(:disabled) { background:rgba(255,255,255,0.05); color:var(--text); }
  .fd-pick:disabled { opacity:0.35; cursor:not-allowed; }
  .fd-pick .file-icon { width:1.2rem; height:1.2rem; }
  :where(html[data-ui="stram"]) .fd-modal { background:#1f232c; box-shadow:none; border-color:rgba(255,255,255,0.12); }
  html[data-ui="stram"] .fd-tabs .tab-btn.active { background:#4a5365; color:#fff; border-color:rgba(255,255,255,0.55); }
  html[data-ui="stram"] .fd-chip { background:rgba(255,255,255,0.06); border-color:rgba(255,255,255,0.18); }
  html[data-ui="stram"] .fd-badge.on { border-color:rgba(255,255,255,0.5); color:#e5e7eb; }
  .fd-list .row-actions { display:flex; gap:0.35rem; flex-shrink:0; }
  .fd-list .danger { background:#ef4444; color:#fff; }
  .fd-list .danger:hover { background:#dc2626; }
  @media (max-width:600px) {
    .fd-tabs .tab-btn { flex:1; padding:0.5rem 0.6rem; }
    .fd-list .row-actions { gap:0.25rem; }
    .fd-list .icon-btn { width:2rem; height:2rem; min-width:2rem; }
    /* mappar på två rader precis som filerna: namnet överst, knapparna under */
    .fd-list .file-row.folder-row { display:grid; grid-template-columns:auto 1fr auto; column-gap:0.75rem; row-gap:0.4rem; align-items:center; }
    .fd-list .file-row.folder-row > .file-icon { grid-row:1 / span 2; align-self:start; }
    .fd-list .file-row.folder-row > .file-name { grid-column:2 / 4; }
    .fd-list .file-row.folder-row > .file-meta { display:block; grid-column:2; font-size:0.75rem; white-space:normal; }
    .fd-list .file-row > .row-actions { grid-column:3; justify-self:end; }
  }
  `;

  function mount(root, member) {
    if (!document.getElementById('fd-style')) {
      const st = document.createElement('style'); st.id = 'fd-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    const me = member.id;
    const isAdmin = member.role === 'admin';
    const isEditor = isAdmin || member.stamledare === true;

    const S = { folders: [], files: [], shares: [], sharedIds: new Set(), members: [], tab: isEditor ? 'mine' : 'shared', folder: null };
    const folderById = id => S.folders.find(f => f.id === id);
    const memberName = id => (S.members.find(m => m.id === id) || {}).name || 'okänd';
    const isMine = it => (it.kind === 'folder' ? it.owner : it.uploaded_by) === me;
    const canEdit = it => isEditor && isMine(it);
    const canDelete = it => canEdit(it) || isAdmin;
    const parentOf = it => it.kind === 'folder' ? it.parent_id : it.folder_id;
    const sharesOf = it => S.shares.filter(s => it.kind === 'folder' ? s.folder_id === it.id : s.file_id === it.id);

    root.innerHTML = `
      <div class="fd-tabs" role="tablist"></div>
      <div class="fd-toolbar"></div>
      <div class="fd-crumbs"></div>
      <div class="card"><div class="fd-list"><p class="text-muted">Laddar...</p></div></div>
      <input type="file" multiple hidden class="fd-input">`;
    const $ = sel => root.querySelector(sel);

    // ---------- data ----------
    async function load() {
      const [fo, fi, sh, ids, mem] = await Promise.all([
        supabaseClient.from('shared_folders').select('id, name, parent_id, owner, created_at'),
        supabaseClient.from('shared_files').select('id, path, name, size, mime, folder_id, uploaded_by, created_at, expires_at'),
        isEditor ? supabaseClient.from('file_shares').select('id, file_id, folder_id, target_type, member_id, stamma') : Promise.resolve({ data: [] }),
        supabaseClient.rpc('fd_shared_with_me_items'),
        S.members.length ? Promise.resolve({ data: S.members }) : supabaseClient.from('members').select('id, name, stamma').eq('status', 'approved').order('name')
      ]);
      const err = [fo, fi, sh, ids, mem].find(r => r.error);
      if (err) {
        $('.fd-list').innerHTML = `<p class="error">${esc(err.error.message)}</p>` +
          (/shared_folders|file_shares|fd_shared/.test(err.error.message) ? '<p class="text-muted">Kör migrationen 2026-11-23_fildelning_mappar.sql i Supabase.</p>' : '');
        return false;
      }
      S.folders = (fo.data || []).map(f => ({ ...f, kind: 'folder' }));
      S.files = (fi.data || []).map(f => ({ ...f, kind: 'file' }));
      S.shares = sh.data || [];
      S.sharedIds = new Set((ids.data || []).map(r => r.id));
      S.members = mem.data || [];
      if (S.folder && !folderById(S.folder)) S.folder = null;
      return true;
    }
    async function refresh() { if (await load()) render(); }

    // ---------- vy ----------
    function itemsIn(folderId) {
      const all = [...S.folders, ...S.files];
      if (folderId) return all.filter(it => parentOf(it) === folderId);
      if (S.tab === 'mine') return all.filter(it => isMine(it) && (!parentOf(it) || !isMine(folderById(parentOf(it)) || {})));
      if (S.tab === 'shared') return all.filter(it => S.sharedIds.has(it.id) && !S.sharedIds.has(parentOf(it)));
      return all.filter(it => !parentOf(it) || !folderById(parentOf(it)));   // alla (admin)
    }

    // Sökvägen från flikens rot till aktuell mapp (i Delat med mig börjar den vid den delade mappen)
    function trail() {
      const out = [];
      let f = folderById(S.folder);
      while (f) {
        out.unshift(f);
        if (S.tab === 'shared' && !S.sharedIds.has(f.parent_id)) break;
        if (S.tab === 'mine' && !isMine(folderById(f.parent_id) || {})) break;
        f = folderById(f.parent_id);
      }
      return out;
    }

    function inheritedShares(it) {
      const out = [];
      let p = folderById(parentOf(it));
      while (p) { sharesOf(p).forEach(s => out.push(`${shareLabel(s)} (via ${p.name})`)); p = folderById(p.parent_id); }
      return out;
    }

    function shareBadge(it) {
      if (!isMine(it)) return '';
      const own = sharesOf(it), inh = inheritedShares(it);
      if (own.length) return `<span class="fd-badge on" title="${esc(own.map(shareLabel).join(', '))}">Delad · ${own.length}</span>`;
      if (inh.length) return `<span class="fd-badge on" title="${esc(inh.join(', '))}">Delad via mapp</span>`;
      return '<span class="fd-badge">Privat</span>';
    }

    function render() {
      const tabs = [];
      if (isEditor) tabs.push(['mine', 'Mina filer']);
      tabs.push(['shared', 'Delat med mig']);
      if (isAdmin) tabs.push(['all', 'Alla filer']);
      $('.fd-tabs').innerHTML = tabs.length > 1
        ? tabs.map(([k, l]) => `<button type="button" class="tab-btn${S.tab === k ? ' active' : ''}" data-tab="${k}">${l}</button>`).join('') : '';
      root.querySelectorAll('.fd-tabs .tab-btn').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; S.folder = null; render(); });

      const here = folderById(S.folder);
      const canUploadHere = isEditor && S.tab === 'mine' && (!here || isMine(here));
      $('.fd-toolbar').innerHTML = canUploadHere
        ? '<button type="button" class="btn-gold fd-newfolder">+ Ny mapp</button><button type="button" class="btn-outline fd-upload">Ladda upp fil(er)</button>' : '';
      if (canUploadHere) {
        $('.fd-newfolder').onclick = newFolder;
        $('.fd-upload').onclick = () => $('.fd-input').click();
      }

      // brödsmulor
      const cr = $('.fd-crumbs');
      cr.innerHTML = '';
      const path = trail();
      if (path.length) {
        const back = document.createElement('button');
        back.type = 'button'; back.className = 'btn-outline crumb-back'; back.textContent = '← Tillbaka';
        back.onclick = () => { S.folder = path.length > 1 ? path[path.length - 2].id : null; render(); };
        cr.appendChild(back);
        const home = document.createElement('a');
        home.textContent = tabs.find(t => t[0] === S.tab)[1];
        home.onclick = () => { S.folder = null; render(); };
        cr.appendChild(home);
        path.forEach((f, i) => {
          cr.insertAdjacentHTML('beforeend', '<span class="sep">/</span>');
          if (i === path.length - 1) { cr.insertAdjacentHTML('beforeend', `<span class="current">${esc(f.name)}</span>`); return; }
          const a = document.createElement('a'); a.textContent = f.name; a.onclick = () => { S.folder = f.id; render(); }; cr.appendChild(a);
        });
      }

      // lista
      const list = $('.fd-list');
      const items = itemsIn(S.folder);
      const folders = items.filter(i => i.kind === 'folder').sort(byName);
      const files = items.filter(i => i.kind === 'file').sort(byName);
      if (!items.length) {
        list.innerHTML = `<p class="text-muted">${S.folder ? 'Mappen är tom.' : S.tab === 'mine' ? 'Du har inga filer här än. Ladda upp eller skapa en mapp – bara de du delar med ser dem.' : S.tab === 'shared' ? 'Inget har delats med dig än.' : 'Inga filer.'}</p>`;
        return;
      }
      list.innerHTML = '';
      [...folders, ...files].forEach(it => list.appendChild(row(it)));
    }

    function row(it) {
      const el = document.createElement('div');
      const isFolder = it.kind === 'folder';
      el.className = 'file-row ' + (isFolder ? 'folder-row' : 'clickable');
      const owner = isMine(it) ? '' : (isFolder ? it.owner : it.uploaded_by);
      const meta = isFolder
        ? (owner ? `Från ${esc(memberName(owner))}` : '')
        : [fmtSize(it.size), fmtDate(it.created_at), owner ? 'från ' + esc(memberName(owner)) : '', it.expires_at ? 'raderas ' + fmtDate(it.expires_at) : ''].filter(Boolean).join(' · ');
      const btns = [];
      if (canEdit(it)) btns.push(['share', 'Dela'], ['rename', 'Byt namn'], ['move', 'Flytta']);
      if (!isFolder) btns.push(['download', 'Ladda ner']);
      if (canDelete(it)) btns.push(['trash', isMine(it) ? 'Radera' : 'Radera (admin)']);
      el.innerHTML = `${isFolder ? ICON.folder : ICON.file}
        <span class="file-name">${esc(it.name)}${shareBadge(it)}</span>
        ${meta ? `<span class="file-meta">${meta}</span>` : ''}
        <div class="row-actions">${btns.map(([k, t]) => `<button type="button" class="${k === 'trash' ? 'danger' : 'btn-outline'} icon-btn" data-act="${k}" title="${t}" aria-label="${t}">${ICON[k]}</button>`).join('')}</div>`;
      el.title = (isFolder ? 'Öppna mappen ' : 'Öppna ') + it.name;
      el.onclick = e => {
        const b = e.target.closest('button[data-act]');
        if (!b) { if (isFolder) { S.folder = it.id; render(); } else openFile(it, false); return; }
        e.stopPropagation();
        ({ share: openShare, rename, move: openMove, download: f => openFile(f, true), trash: remove })[b.dataset.act](it);
      };
      return el;
    }

    // ---------- filer ----------
    async function openFile(f, download) {
      const win = download ? null : window.open('', '_blank');
      const { data, error } = await supabaseClient.storage.from(BUCKET).createSignedUrl(f.path, 3600, download ? { download: f.name } : undefined);
      if (error || !data) { if (win) win.close(); say('Kunde inte öppna filen' + (error ? ': ' + error.message : '')); return; }
      if (download) { const a = document.createElement('a'); a.href = data.signedUrl; document.body.appendChild(a); a.click(); a.remove(); return; }
      const url = OFFICE_EXT.test(f.name) ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(data.signedUrl)}` : data.signedUrl;
      if (win) win.location.href = url; else location.href = url;
    }

    $('.fd-input').onchange = async e => {
      const list = Array.from(e.target.files || []);
      e.target.value = '';
      if (!list.length) return;
      const btn = $('.fd-upload');
      btn.disabled = true;
      const failed = [];
      let ok = 0;
      for (let i = 0; i < list.length; i++) {
        let file = list[i];
        if (window.AudioEdit && AudioEdit.isUncompressedAudio && AudioEdit.isUncompressedAudio(file)) {
          try { file = await AudioEdit.toMp3File(file, 192, p => { btn.textContent = `Gör om till MP3… ${Math.round(p * 100)} %`; }); }
          catch (_) { failed.push(`${file.name}: kunde inte göras om till MP3`); continue; }
        }
        btn.textContent = list.length > 1 ? `Laddar upp ${i + 1}/${list.length}…` : 'Laddar upp…';
        const path = `${crypto.randomUUID()}/${safeName(file.name)}`;
        const { error: upErr } = await supabaseClient.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
        if (upErr) { failed.push(`${file.name}: ${upErr.message}`); continue; }
        const { error: rowErr } = await supabaseClient.from('shared_files').insert({
          path, name: file.name, size: file.size, mime: file.type || null, folder_id: S.folder, uploaded_by: me
        });
        if (rowErr) { await supabaseClient.storage.from(BUCKET).remove([path]); failed.push(`${file.name}: ${rowErr.message}`); continue; }
        ok++;
      }
      btn.disabled = false;
      await refresh();
      if (failed.length) alert('Följande filer kunde inte laddas upp:\n\n' + failed.join('\n'));
      if (ok) say(ok === 1 ? 'Uppladdad – bara du ser den tills du delar den' : `${ok} filer uppladdade`, 4000);
    };

    async function newFolder() {
      const name = (prompt('Namn på ny mapp:') || '').trim();
      if (!name) return;
      if (name.includes('/')) { say('Mappnamnet får inte innehålla /'); return; }
      const { error } = await supabaseClient.from('shared_folders').insert({ name, parent_id: S.folder, owner: me });
      if (error) { say('Fel: ' + error.message); return; }
      await refresh();
    }

    async function rename(it) {
      const input = prompt(`Nytt namn på ${it.kind === 'folder' ? 'mappen' : 'filen'}:`, it.name);
      if (input == null) return;
      let name = input.trim();
      if (!name || name === it.name) return;
      if (name.includes('/')) { say('Namnet får inte innehålla /'); return; }
      const ext = it.kind === 'file' && it.name.includes('.') ? it.name.slice(it.name.lastIndexOf('.')) : '';
      if (ext && !name.includes('.')) name += ext;   // tappad filändelse: behåll den gamla
      const { error } = it.kind === 'folder'
        ? await supabaseClient.from('shared_folders').update({ name }).eq('id', it.id)
        : await supabaseClient.from('shared_files').update({ name }).eq('id', it.id);
      if (error) { say('Fel: ' + error.message); return; }
      await refresh();
    }

    async function remove(it) {
      const others = !isMine(it) ? ` (uppladdad av ${memberName(it.kind === 'folder' ? it.owner : it.uploaded_by)})` : '';
      if (it.kind === 'folder') {
        if (!confirm(`Radera mappen "${it.name}"${others} och allt innehåll i den? Det går inte att ångra.`)) return;
        const { data, error } = await supabaseClient.rpc('fd_delete_folder', { p_id: it.id });
        if (error) { say('Fel: ' + error.message); return; }
        const paths = (data || []).map(r => typeof r === 'string' ? r : r.fd_delete_folder).filter(Boolean);
        for (let i = 0; i < paths.length; i += 100) await supabaseClient.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      } else {
        if (!confirm(`Radera "${it.name}"${others}? Den försvinner för alla den är delad med.`)) return;
        const { error } = await supabaseClient.from('shared_files').delete().eq('id', it.id);
        if (error) { say('Fel: ' + error.message); return; }
        await supabaseClient.storage.from(BUCKET).remove([it.path]);
      }
      say('Raderad');
      await refresh();
    }

    // ---------- dialoger ----------
    function modal(html) {
      const bg = document.createElement('div');
      bg.className = 'fd-modal-bg';
      bg.innerHTML = `<div class="fd-modal" role="dialog" aria-modal="true">${html}</div>`;
      const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = e => { if (e.key === 'Escape') close(); };
      bg.addEventListener('click', e => { if (e.target === bg) close(); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(bg);
      return { el: bg.firstElementChild, close };
    }

    function openMove(it) {
      // egna mappar som träd; mappen själv och dess undermappar går inte att välja
      const banned = new Set();
      if (it.kind === 'folder') {
        const walk = id => { banned.add(id); S.folders.filter(f => f.parent_id === id).forEach(f => walk(f.id)); };
        walk(it.id);
      }
      const opts = [{ id: null, name: 'Mina filer (översta nivån)', depth: 0 }];
      const add = (pid, d) => S.folders.filter(f => f.parent_id === pid && isMine(f)).sort(byName).forEach(f => { opts.push({ id: f.id, name: f.name, depth: d }); add(f.id, d + 1); });
      add(null, 1);
      const m = modal(`<h3>Flytta till…</h3><div class="fd-body"><p class="fd-sub">${esc(it.name)}</p><div class="fd-picks"></div></div>
        <div class="fd-actions"><button type="button" class="btn-outline fd-cancel">Avbryt</button></div>`);
      m.el.querySelector('.fd-cancel').onclick = m.close;
      const box = m.el.querySelector('.fd-picks');
      opts.forEach(o => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'fd-pick';
        b.style.paddingLeft = (0.6 + o.depth * 1.1) + 'rem';
        b.innerHTML = `${ICON.folder}<span>${esc(o.name)}</span>`;
        b.disabled = o.id === parentOf(it) || banned.has(o.id);
        b.onclick = async () => {
          m.close();
          const { error } = it.kind === 'folder'
            ? await supabaseClient.from('shared_folders').update({ parent_id: o.id }).eq('id', it.id)
            : await supabaseClient.from('shared_files').update({ folder_id: o.id }).eq('id', it.id);
          if (error) { say('Fel: ' + error.message); return; }
          say('Flyttad');
          await refresh();
        };
        box.appendChild(b);
      });
    }

    function shareLabel(s) {
      if (s.target_type === 'medlem') return memberName(s.member_id);
      if (s.target_type === 'stamma') return 'Stämma: ' + s.stamma;
      return TARGET_LABEL[s.target_type];
    }

    function openShare(it) {
      const isFolder = it.kind === 'folder';
      const m = modal(`<h3>Dela "${esc(it.name)}"</h3>
        <div class="fd-body">
          <p class="fd-sub">Bara du${isAdmin ? '' : ', admin'} och de du väljer här kan se ${isFolder ? 'mappen och allt i den' : 'filen'}.</p>
          <div><h4>Delad med</h4><div class="fd-chips fd-current" style="margin-top:0.4rem;"></div><p class="fd-sub fd-inherit" style="margin-top:0.5rem;"></p></div>
          <div><h4>Grupper</h4><div class="fd-chips fd-groups" style="margin-top:0.4rem;"></div></div>
          <div><h4>Medlemmar</h4>
            <input type="search" class="fd-search" placeholder="Sök medlem…" style="margin:0.4rem 0;">
            <div class="fd-members"></div>
            <button type="button" class="btn-gold fd-addmembers" style="margin-top:0.6rem;">Dela med valda</button>
          </div>
        </div>
        <div class="fd-actions"><button type="button" class="btn-outline fd-done">Klar</button></div>`);
      const q = s => m.el.querySelector(s);
      q('.fd-done').onclick = m.close;

      const stammor = [...new Set(S.members.map(x => x.stamma).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'sv'));
      const others = S.members.filter(x => x.id !== me);
      q('.fd-members').innerHTML = others.map(x =>
        `<label><input type="checkbox" value="${x.id}"><span>${esc(x.name)}</span>${x.stamma ? `<small>${esc(x.stamma)}</small>` : ''}</label>`).join('') || '<p class="text-muted">Inga andra medlemmar.</p>';
      q('.fd-search').oninput = e => {
        const t = e.target.value.trim().toLowerCase();
        m.el.querySelectorAll('.fd-members label').forEach(l => { l.hidden = !!t && !l.textContent.toLowerCase().includes(t); });
      };

      const key = s => s.target_type + ':' + (s.member_id || s.stamma || '');
      async function add(rows) {
        const have = new Set(sharesOf(it).map(key));
        rows = rows.filter(r => !have.has(key(r))).map(r => ({ ...r, [isFolder ? 'folder_id' : 'file_id']: it.id }));
        if (!rows.length) return;
        const { error } = await supabaseClient.from('file_shares').insert(rows);
        if (error) { say('Fel: ' + error.message); return; }
        await refresh(); draw();
      }

      function draw() {
        const cur = sharesOf(it);
        q('.fd-current').innerHTML = cur.length
          ? cur.map(s => `<span class="fd-chip">${esc(shareLabel(s))}<button type="button" data-id="${s.id}" title="Sluta dela" aria-label="Sluta dela med ${esc(shareLabel(s))}">×</button></span>`).join('')
          : '<span class="fd-sub">Ingen ännu – bara du ser den.</span>';
        m.el.querySelectorAll('.fd-current button[data-id]').forEach(b => b.onclick = async () => {
          const { error } = await supabaseClient.from('file_shares').delete().eq('id', b.dataset.id);
          if (error) { say('Fel: ' + error.message); return; }
          await refresh(); draw();
        });

        // delningar som ärvs från mappar ovanför
        const inh = inheritedShares(it);
        q('.fd-inherit').textContent = inh.length ? 'Ärver också: ' + inh.join(', ') : '';

        const have = new Set(cur.map(key));
        const groups = [['alla', null, 'Alla aktiva'], ['korledning', null, 'Körledningen'], ...stammor.map(s => ['stamma', s, s])];
        q('.fd-groups').innerHTML = groups.map(([t, v, l]) =>
          `<button type="button" class="btn-outline" data-t="${t}" data-v="${esc(v || '')}" ${have.has(t + ':' + (v || '')) ? 'disabled' : ''}>+ ${esc(l)}</button>`).join('');
        m.el.querySelectorAll('.fd-groups button').forEach(b => b.onclick = () =>
          add([b.dataset.t === 'stamma' ? { target_type: 'stamma', stamma: b.dataset.v } : { target_type: b.dataset.t }]));
        m.el.querySelectorAll('.fd-members input').forEach(c => { c.checked = false; c.disabled = have.has('medlem:' + c.value); });
      }

      q('.fd-addmembers').onclick = () => {
        const ids = [...m.el.querySelectorAll('.fd-members input:checked')].map(c => c.value);
        if (!ids.length) { say('Bocka i en eller flera medlemmar först'); return; }
        add(ids.map(id => ({ target_type: 'medlem', member_id: id })));
      };
      draw();
    }

    refresh();
  }

  window.Fildelning = { mount };
})();
