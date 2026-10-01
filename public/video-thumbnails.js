// A gallery must not open one decoder/network stream per video tile.
// Only visible thumbnails are queued; one temporary decoder serves all tiles.
(() => {
  const pending = new Set(), cache = new Map(), failures = new Map();
  const MAX_CACHE = 100, TIMEOUT = 10000;
  let active = null;
  const placeholder = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#160e24"/><path d="M146 67v46l37-23z" fill="#a78bca"/></svg>');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const img = entry.target;
      if (entry.isIntersecting) pending.add(img); else pending.delete(img);
    }
    pump();
  }, { rootMargin:'100px' });
  function remember(url, preview) {
    cache.delete(url); cache.set(url, preview);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  }
  function pump() {
    if (active || document.hidden) return;
    for (const img of pending) {
      pending.delete(img);
      if (!img.isConnected || !img.getClientRects().length) continue;
      const url = img.dataset.videoThumbnail;
      if (cache.has(url)) { img.src = cache.get(url); observer.unobserve(img); continue; }
      if ((failures.get(url) || 0) > Date.now()) continue;
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.preload = 'auto';
      let done = false;
      const finish = preview => {
        if (done) return;
        done = true; clearTimeout(timer);
        video.onloadeddata = null; video.onerror = null;
        video.pause(); video.removeAttribute('src'); video.load();
        if (preview) { remember(url, preview); if (img.isConnected) img.src = preview; }
        else {
          failures.set(url, Date.now() + 60000);
          while (failures.size > MAX_CACHE) failures.delete(failures.keys().next().value);
        }
        observer.unobserve(img); active = null; pump();
      };
      const timer = setTimeout(() => finish(null), TIMEOUT);
      active = { img, cancel:() => finish(null) };
      video.onerror = () => finish(null);
      video.onloadeddata = () => {
        try {
          if (!video.videoWidth || !video.videoHeight) return finish(null);
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', 0.75));
        } catch { finish(null); }
      };
      video.src = url; video.load();
      return;
    }
  }
  function scan(root) {
    const items = [...(root.querySelectorAll?.('img[data-video-thumbnail]') || [])];
    if (root.matches?.('img[data-video-thumbnail]')) items.unshift(root);
    for (const img of items) {
      if (img.dataset.thumbnailObserved) continue;
      img.dataset.thumbnailObserved = 'true'; img.src = placeholder;
      if (cache.has(img.dataset.videoThumbnail)) img.src = cache.get(img.dataset.videoThumbnail);
      else observer.observe(img);
    }
  }
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        const items = [...(node.querySelectorAll?.('img[data-video-thumbnail]') || [])];
        if (node.matches?.('img[data-video-thumbnail]')) items.push(node);
        for (const img of items) {
          if (img.isConnected) continue;
          pending.delete(img); observer.unobserve(img);
          if (active?.img === img) active.cancel();
        }
      }
      for (const node of record.addedNodes) scan(node);
    }
  }).observe(document.body, { childList:true, subtree:true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) active?.cancel(); else pump(); });
  scan(document.body);
})();
