import { ConnectionFailure } from '../../src/shared/connection-failure';

export class ProviderError extends Error {
  constructor(message: string, public code = -1) { super(message); this.name = 'ProviderError'; }
}
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36';
const hosts = new Set(['api.bilibili.com', 'app.bilibili.com', 'passport.bilibili.com', 'api.live.bilibili.com']);
const connectionMessages = {
  dns: '无法解析 B 站地址，请检查电视的 DNS 设置后重试',
  tls: '无法建立 B 站安全连接，请检查电视日期时间或系统更新后重试',
  timeout: '连接 B 站超时，请稍后重试',
  offline: '无法连接 B 站，请稍后重试',
};
export type Params = Record<string, string | number | boolean | undefined>;
export class BiliHttp {
  constructor(private cookie: () => string, private fetcher: typeof fetch = fetch) {}
  async raw(url: string, params: Params | URLSearchParams = {}, post = false, cookie = true, timeoutMs = 15000) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !hosts.has(target.hostname)) throw new Error('不允许的接口地址');
    const body = params instanceof URLSearchParams ? params : new URLSearchParams(Object.entries(params).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)]));
    if (!post) target.search = body.toString();
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Referer: 'https://www.bilibili.com/', Accept: target.hostname === 'app.bilibili.com' ? '*/*' : 'application/json' };
    if (post) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (cookie && this.cookie()) headers.Cookie = this.cookie();
    let response: Response;
    try { response = await this.fetcher(target, { method: post ? 'POST' : 'GET', headers, body: post ? body : undefined, credentials: cookie ? 'include' : 'omit', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
    catch (error) {
      throw new ProviderError(error instanceof ConnectionFailure ? connectionMessages[error.kind]
        : '连接 B 站失败或超时，请检查网络后重试');
    }
    if (!response.ok) throw new ProviderError(`B 站接口返回 HTTP ${response.status}`, response.status);
    let payload: any;
    try { payload = await response.json(); } catch { throw new ProviderError('B 站返回了验证页面，请稍后重试', -412); }
    return { payload, headers: response.headers };
  }
  async get(url: string, params: Params | URLSearchParams = {}, post = false, cookie = true): Promise<any> {
    const { payload } = await this.raw(url, params, post, cookie);
    if (payload.code !== 0) {
      const message = payload.code === -101 ? '网页登录已失效，请重新扫码' : payload.code === -412 || payload.code === -352 ? '请求被 B 站风控暂时限制，请稍后重试' : String(payload.message || payload.msg || 'B 站暂时无法提供此内容');
      throw new ProviderError(message, payload.code);
    }
    return payload.data ?? payload.result;
  }
}
