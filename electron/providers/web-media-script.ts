export interface WebMediaCandidate {
  url: string;
  mime?: string;
  score: number;
  referer: string;
  visibleArea?: number;
}
export interface WebMediaInspection { title: string; candidates: WebMediaCandidate[] }

/** Serialized into an isolated remote frame; all helpers must remain local. */
export function inspectWebMedia(): WebMediaInspection {
  const candidates: WebMediaCandidate[] = [];
  const add = (value: unknown, score: number, mime?: string, visibleArea?: number) => {
    if (typeof value !== 'string' || !value || value.length > 10000 || candidates.length >= 100) return;
    try {
      const url = new URL(value, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
      candidates.push({ url: url.href, score, mime, referer: location.href, visibleArea });
    } catch { /* Ignore non-address page metadata. */ }
  };
  for (const video of Array.from(document.querySelectorAll('video')).slice(0, 20)) {
    const bounds = video.getBoundingClientRect();
    const visibleArea = video.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      ? Math.min(100000000, bounds.width * bounds.height) : 0;
    const score = 1000 + Math.min(100, bounds.width * bounds.height / 10000);
    add(video.currentSrc, score, undefined, visibleArea);
    add(video.getAttribute('src'), score, undefined, visibleArea);
    add(video.dataset.src, score, undefined, visibleArea);
    for (const source of Array.from(video.querySelectorAll('source')).slice(0, 20)) {
      add(source.src, score, source.type, visibleArea);
      add(source.dataset.src, score, source.type, visibleArea);
    }
    // Trigger lazy media setup without playing audible content or clicking page links.
    video.muted = true;
    if (visibleArea > 0 && video.paused) void video.play().catch(() => {});
  }
  const controls = '.vjs-big-play-button, .dplayer-play-icon, .jw-icon-display, [data-plyr="play"]';
  for (const control of Array.from(document.querySelectorAll<HTMLElement>(controls)).slice(0, 10)) {
    if (control.dataset.yingjiProbeClicked || control.closest('a')) continue;
    control.dataset.yingjiProbeClicked = 'true';
    control.click();
  }
  for (const meta of Array.from(document.querySelectorAll('meta[property], meta[name]'))) {
    if (/^(og:video(?::url|:secure_url)?|twitter:player:stream)$/i.test(meta.getAttribute('property') || meta.getAttribute('name') || '')) {
      add(meta.getAttribute('content'), 500);
    }
  }
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) {
      value.slice(0, 50).forEach(entry => visit(entry, depth + 1));
      return;
    }
    const entry = value as Record<string, unknown>;
    if (entry['@type'] === 'VideoObject') add(entry.contentUrl, 600);
    Object.values(entry).slice(0, 50).forEach(child => visit(child, depth + 1));
  };
  for (const script of Array.from(document.querySelectorAll('script')).slice(0, 80)) {
    const text = (script.textContent || '').slice(0, 100000);
    if (script.type === 'application/ld+json') {
      try { visit(JSON.parse(text)); } catch { /* Invalid page metadata is not fatal. */ }
    }
    // Common player configuration strings; never evaluate downloaded source code here.
    for (const match of text.matchAll(/["']((?:https?:)?(?:\\?\/){2}[^"'<>\s]+?\.(?:m3u8|mpd|mp4|webm)(?:\?[^"'<>\s]*)?)["']/gi)) {
      add(match[1].replace(/\\\//g, '/').replace(/&amp;/g, '&'), 350);
    }
  }
  for (const entry of performance.getEntriesByType('resource').slice(-100)) {
    if (/\.(m3u8|mpd|mp4|webm)(?:$|\?)/i.test(entry.name)) add(entry.name, /\.(m3u8|mpd)(?:$|\?)/i.test(entry.name) ? 800 : 200);
  }
  return { title: document.title.slice(0, 500), candidates };
}
