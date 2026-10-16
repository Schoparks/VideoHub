import { BiliHttp, ProviderError } from './http';
import { wbiParams } from './signing';

interface Keys { img: string; sub: string; expires: number }
const API = 'https://api.bilibili.com';

/** Signed operations share one key request, including after invalidation. */
export class BilibiliSigning {
  private cached?: Keys;
  private pending?: Promise<Keys>;

  constructor(private http: BiliHttp) {}

  reset() {
    this.cached = undefined;
    this.pending = undefined;
  }

  private async keys(): Promise<Keys> {
    if (this.cached && this.cached.expires >= Date.now()) return this.cached;
    if (this.pending) return this.pending;
    const job = (async () => {
      const { payload } = await this.http.raw(`${API}/x/web-interface/nav`);
      const keys = payload.data?.wbi_img;
      if (!keys) throw new Error('无法获取 B 站播放签名，请稍后重试');
      const key = (url: string) => new URL(url).pathname.split('/').pop()!.split('.')[0];
      return { img: key(keys.img_url), sub: key(keys.sub_url), expires: Date.now() + 3600000 };
    })();
    this.pending = job;
    try {
      const keys = await job;
      if (this.pending === job) this.cached = keys;
      return keys;
    } finally {
      if (this.pending === job) this.pending = undefined;
    }
  }

  /** Overlap fresh detail loading with keys; keep detail failures authoritative. */
  async withKeys<T>(load: () => Promise<T>): Promise<T> {
    const ready = this.keys().then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    const value = await load();
    const result = await ready;
    if (!result.ok) throw result.error;
    return value;
  }

  async get(path: string, params: Record<string, string | number>, retry = true): Promise<any> {
    const keys = await this.keys();
    try {
      return await this.http.get(`${API}${path}`, new URLSearchParams(wbiParams(params, keys.img, keys.sub)));
    } catch (error) {
      if (!retry || !(error instanceof ProviderError) || error.code !== -403) throw error;
      // A late rejection must not evict a newer key load started by another category.
      if (this.cached === keys) this.reset();
      return this.get(path, params, false);
    }
  }
}
