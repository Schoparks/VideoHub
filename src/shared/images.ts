/** Bilibili image URLs are often protocol-relative or plain HTTP. */
export function normalizeImageUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    if (isBilibiliImageHost(url.hostname)) url.protocol = 'https:';
    return url.href;
  } catch { return undefined; }
}

export function isBilibiliImageHost(host: string): boolean {
  return ['hdslb.com', 'biliimg.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
}

export type ArtworkSize = 160 | 960 | 1440;

/** Presentation-only CDN thumbnails: keep the source identity and original aspect ratio. */
export function thumbnailUrl(value?: string, size: ArtworkSize = 960): string | undefined {
  const address = normalizeImageUrl(value);
  if (!address) return undefined;
  const url = new URL(address);
  if (!isBilibiliImageHost(url.hostname) || url.port || url.search) return address;
  const match = url.pathname.match(/^(.*\/[^/@]+\.(?:jpe?g|png|webp|avif))(?:@[^/]*)?$/i);
  if (!match) return address;
  url.pathname = `${match[1]}@${size}w_${size}h.webp`;
  return url.href;
}

export function coverUrl(value?: string, desktop = false): string | undefined {
  const url = normalizeImageUrl(value);
  if (!url) return undefined;
  return desktop && isBilibiliImageHost(new URL(url).hostname)
    ? `yingji://app/image?url=${encodeURIComponent(url)}` : url;
}
