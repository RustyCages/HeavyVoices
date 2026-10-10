// Party Mode – casta ljud/video till Google Home, Nest, Chromecast (Google Cast) och AirPlay.
//  • Google Cast: Googles Web Sender SDK + Default Media Receiver – högtalaren hämtar strömmen själv,
//    så mobilen/datorn kan låsas. Fungerar i Chrome (Android, dator) – inte i webbläsare på iPhone.
//  • AirPlay: Safari (iPhone/iPad/Mac) – visar Apples högtalarväljare för ett <audio>/<video>.
// Används av medlem/party-radio.html (Bergsprängaren) och medlem/party-tv.html (Rock-TV).
(function (root) {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canCast = !isIOS && /Chrome\/|CriOS|Edg\//.test(ua);
  const subs = { state: [], ended: [], session: [], avail: [] };
  const emit = (k, v) => subs[k].forEach(f => { try { f(v); } catch (e) { console.error(e); } });
  let ctx = null, player = null, ctrl = null, lastState = 'IDLE', loadAt = 0, available = false;

  function init() {
    ctx = cast.framework.CastContext.getInstance();
    ctx.setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
    player = new cast.framework.RemotePlayer();
    ctrl = new cast.framework.RemotePlayerController(player);
    const upd = () => { available = ctx.getCastState() !== cast.framework.CastState.NO_DEVICES_AVAILABLE; emit('avail', available); };
    ctx.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, upd);
    ctrl.addEventListener(cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED, () => emit('session', player.isConnected));
    ctrl.addEventListener(cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED, () => {
      const st = player.playerState || 'IDLE';
      emit('state', st);
      // klippet tog slut på högtalaren/TV:n (inte vårt eget stopp eller byte)
      if (st === 'IDLE' && (lastState === 'PLAYING' || lastState === 'BUFFERING') && Date.now() - loadAt > 2500) {
        const s = ctx.getCurrentSession(), m = s && s.getMediaSession();
        if (!m || m.idleReason === 'FINISHED' || m.idleReason == null) emit('ended');
      }
      lastState = st;
    });
    upd();
    if (player.isConnected) emit('session', true);
  }
  if (canCast) {
    root.__onGCastApiAvailable = ok => { if (ok) { try { init(); } catch (e) { console.warn('Cast', e); } } };
    const s = document.createElement('script');
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    s.async = true; document.head.appendChild(s);
  }

  const api = {
    get supported() { return canCast; },
    get available() { return available; },
    get connected() { return !!(player && player.isConnected); },
    get device() { const s = ctx && ctx.getCurrentSession(); return s ? s.getCastDevice().friendlyName : ''; },
    get state() { return player ? player.playerState || 'IDLE' : 'IDLE'; },
    on(k, f) { subs[k].push(f); },
    // öppnar Chromes högtalarväljare (där finns också "Sluta casta")
    pick() { if (ctx) return ctx.requestSession().catch(() => {}); return Promise.resolve(); },
    stopCasting() { if (ctx) ctx.endCurrentSession(true); },
    // media: { url, type, title, sub, image, live, video }
    async load(m) {
      const s = ctx && ctx.getCurrentSession(); if (!s) return false;
      const mi = new chrome.cast.media.MediaInfo(m.url, m.type || 'audio/mpeg');
      mi.streamType = m.live ? chrome.cast.media.StreamType.LIVE : chrome.cast.media.StreamType.BUFFERED;
      const md = m.video ? new chrome.cast.media.GenericMediaMetadata() : new chrome.cast.media.MusicTrackMediaMetadata();
      md.title = m.title || 'Heavy Voices';
      if (m.video) md.subtitle = m.sub || ''; else md.artist = m.sub || 'Heavy Voices';
      md.images = [new chrome.cast.Image(m.image || location.origin + '/icons/logo.png')];
      mi.metadata = md;
      const req = new chrome.cast.media.LoadRequest(mi); req.autoplay = true;
      loadAt = Date.now();
      try { await s.loadMedia(req); return true; } catch (e) { console.warn('Cast load', e); return false; }
    },
    playOrPause() { if (ctrl) ctrl.playOrPause(); },
    stop() { if (ctrl && player.isConnected) { loadAt = Date.now(); ctrl.stop(); } },
    setVolume(v) { if (ctrl && player.isConnected) { player.volumeLevel = Math.max(0, Math.min(1, v)); ctrl.setVolumeLevel(); } },

    // Knapp som syns när det finns en Cast-enhet i nätverket. label(connected, device) → text
    button(btn, label) {
      const draw = () => {
        btn.hidden = !(available || api.connected);
        btn.textContent = label ? label(api.connected, api.device) : (api.connected ? `📡 ${api.device}` : '📡 Casta');
        btn.setAttribute('aria-pressed', String(api.connected));
        btn.title = api.connected ? `Castar till ${api.device} – tryck för att byta eller sluta` : 'Spela på Google Home / Chromecast';
      };
      btn.hidden = true;
      btn.addEventListener('click', () => api.pick());
      api.on('avail', draw); api.on('session', draw);
      draw();
    },
    // AirPlay-knapp för ett <audio>/<video> i Safari
    airplay(btn, el) {
      btn.hidden = true;
      if (!root.WebKitPlaybackTargetAvailabilityEvent || !el.webkitShowPlaybackTargetPicker) return;
      el.setAttribute('x-webkit-airplay', 'allow');
      el.addEventListener('webkitplaybacktargetavailabilitychanged', e => { btn.hidden = e.availability !== 'available'; });
      btn.addEventListener('click', () => { try { el.webkitShowPlaybackTargetPicker(); } catch (e) {} });
    },
  };
  root.PartyCast = api;
})(window);
