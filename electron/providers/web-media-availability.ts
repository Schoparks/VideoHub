import { httpMediaUrl } from './url-media';

function resourceKey(address: string): string | undefined {
  try {
    const url = new URL(httpMediaUrl(address));
    url.hash = '';
    return url.href;
  } catch { return undefined; }
}

/** Only current HTTP 404/410 evidence excludes a resource; no extra media requests. */
export class WebMediaAvailability {
  private unavailable = new Set<string>();
  private redirects = new Map<number, Set<string>>();

  redirect(id: number, from: string, to: string) {
    const keys = this.redirects.get(id) || new Set<string>();
    for (const address of [from, to]) {
      const key = resourceKey(address);
      if (key && keys.size < 8) keys.add(key);
    }
    if (!keys.size) return;
    if (!this.redirects.has(id) && this.redirects.size >= 200) {
      this.redirects.delete(this.redirects.keys().next().value!);
    }
    this.redirects.set(id, keys);
  }

  hasRedirect(id: number) { return this.redirects.has(id); }

  observe(id: number, address: string, status: number) {
    if (status >= 300 && status < 400) return;
    const keys = this.redirects.get(id) || new Set<string>();
    this.redirects.delete(id);
    const key = resourceKey(address);
    if (key) keys.add(key);
    for (const resource of keys) {
      if (status === 404 || status === 410) {
        if (this.unavailable.size < 200) this.unavailable.add(resource);
      } else this.unavailable.delete(resource);
    }
  }

  isUnavailable(address: string) {
    const key = resourceKey(address);
    return key !== undefined && this.unavailable.has(key);
  }

  clear() {
    this.unavailable.clear();
    this.redirects.clear();
  }
}
