// Bakgrundsvideo som följer låtens uppspelning (songs.bg_video_path / bg_video_offset / bg_video_loop).
// Används bakom karaoketexten i spelaren och i Röstövning. Videon är alltid tyst – ljudet kommer
// från stämfilerna. Videotid = låtens tid (gemensam tidslinje) + bg_video_offset.
(function (root) {
  const urlCache = new Map();   // sökväg → { url, exp }

  async function signedUrl(client, bucket, path) {
    const c = urlCache.get(path);
    if (c && c.exp > Date.now() + 60e3) return c.url;
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 3600 * 6);
    if (error) throw error;
    urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 3600e3 * 6 });
    return data.signedUrl;
  }

  function create(container, opts = {}) {
    let vid = null, path = null, song = null, token = 0;
    const cls = opts.className || 'bg-video';

    async function setSong(s, client, bucket) {
      song = s;
      const want = s && s.bg_video_path ? s.bg_video_path : null;
      if (want === path && vid) return;
      const my = ++token;
      if (vid) { vid.pause(); vid.remove(); vid = null; }
      path = want;
      container.classList.toggle('has-bg-video', !!want);
      if (!want) return;
      let url;
      try { url = await signedUrl(client, bucket, want); } catch (e) { return; }
      if (my !== token) return;
      const v = document.createElement('video');
      v.className = cls; v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
      v.src = url;
      container.prepend(v);
      vid = v;
    }

    // t = låtens tid i sekunder, playing = spelar just nu
    function sync(t, playing) {
      if (!vid || vid.readyState < 1 || !song) return;
      let tgt = t + (Number(song.bg_video_offset) || 0);
      const dur = vid.duration || 0;
      const loop = !!song.bg_video_loop && dur > 0.5;
      vid.loop = loop;
      if (loop) tgt = ((tgt % dur) + dur) % dur;
      else if (tgt < 0 || (dur && tgt > dur)) { if (!vid.paused) vid.pause(); return; }
      let diff = vid.currentTime - tgt;
      if (loop && Math.abs(diff) > dur / 2) diff -= Math.sign(diff) * dur;
      if (playing) {
        if (vid.paused) vid.play().catch(() => {});
        if (Math.abs(diff) > 0.35) { if (!vid.seeking) vid.currentTime = tgt; }
        else vid.playbackRate = Math.abs(diff) > 0.04 ? (diff > 0 ? 0.96 : 1.04) : 1;
      } else {
        if (!vid.paused) vid.pause();
        if (Math.abs(diff) > 0.06 && !vid.seeking) vid.currentTime = tgt;
      }
    }

    function show(on) { if (vid) vid.hidden = !on; container.classList.toggle('has-bg-video', !!(on && path)); }

    return { setSong, sync, show, get element() { return vid; }, get active() { return !!path; } };
  }

  root.BgVideo = { create };
})(window);
