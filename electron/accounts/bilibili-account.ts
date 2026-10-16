import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import type { AccountStatus, LoginPoll, QRLogin } from '../../src/shared/types';
import { BiliHttp, ProviderError } from '../protocol/http';
import { tvParams } from '../protocol/signing';
import { Vault, type Credentials } from './vault';
/** TV QR authorization may also issue web credentials; keep them for authenticated playback. */
function webCredentials(data: any): Pick<Credentials, 'cookie' | 'webMid'> {
  const allowed = new Set(['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']);
  const cookies = (data?.cookie_info?.cookies || []).filter((c: any) => allowed.has(c.name) && typeof c.value === 'string' && c.value && !/[;\r\n]/.test(c.value));
  if (!cookies.some((c: any) => c.name === 'SESSDATA')) return {};
  return { cookie: cookies.map((c: any) => `${c.name}=${c.value}`).join('; '), webMid: cookies.find((c: any) => c.name === 'DedeUserID')?.value || String(data.token_info?.mid || data.mid || '') || undefined };
}
export class BilibiliAccount {
  private codes = new Map<string, { type: 'app' | 'web'; code: string; expires: number; generation: number }>();
  private refresh?: Promise<boolean>;
  readonly http: BiliHttp;
  constructor(readonly vault: Vault, fetcher?: typeof fetch) { this.http = new BiliHttp(() => vault.value.cookie || '', fetcher); }
  status(): AccountStatus {
    const v = this.vault.value;
    return { app: !!v.accessToken && (!v.expiresAt || v.expiresAt > Date.now()), web: !!v.cookie, appMid: v.appMid, webMid: v.webMid, name: v.name, avatar: v.avatar, storage: this.vault.storage, warning: this.vault.warning || (v.appMid && v.webMid && v.appMid !== v.webMid ? 'App 与网页登录的账号不同，请用同一账号重新授权。' : undefined) };
  }
  async start(type: 'app' | 'web'): Promise<QRLogin> {
    this.codes.clear();
    const data = type === 'app'
      ? await this.http.get('https://passport.bilibili.com/x/passport-tv-login/qrcode/auth_code', tvParams({ local_id: '0', ts: '0' }), true, false)
      : await this.http.get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {}, false, false);
    const id = randomUUID(), expiresAt = Date.now() + 180000;
    this.codes.set(id, { type, code: data.auth_code || data.qrcode_key, expires: expiresAt, generation: this.vault.generation });
    return { id, type, expiresAt, image: await QRCode.toDataURL(data.url, { width: 280, margin: 2 }) };
  }
  cancel(id: string) { this.codes.delete(id); }
  async poll(id: string): Promise<LoginPoll> {
    const qr = this.codes.get(id);
    if (!qr || qr.expires < Date.now()) { this.codes.delete(id); return { state: 'expired' }; }
    const { payload, headers } = qr.type === 'app'
      ? await this.http.raw('https://passport.bilibili.com/x/passport-tv-login/qrcode/poll', tvParams({ auth_code: qr.code, local_id: '0', ts: '0' }), true, false)
      : await this.http.raw('https://passport.bilibili.com/x/passport-login/web/qrcode/poll', { qrcode_key: qr.code }, false, false);
    const code = qr.type === 'app' ? payload.code : payload.data?.code ?? payload.code;
    if (code === 86038) return { state: 'expired' };
    if ([86039, 86101].includes(code)) return { state: 'waiting' };
    if ([86097, 86090].includes(code)) return { state: 'scanned' };
    if (code !== 0) throw new ProviderError(String(payload.message || '扫码授权失败'), code);
    if (!this.codes.has(id) || this.vault.generation !== qr.generation) return { state: 'expired' };
    const data = payload.data;
    if (qr.type === 'app') {
      const token = data.token_info || data;
      if (!token.access_token) throw new Error('授权未返回 App 令牌');
      const lifetime = Number(token.expires_in || data.expires_in || 0);
      const saved = await this.vault.update({ accessToken: token.access_token, refreshToken: token.refresh_token || data.refresh_token, appMid: String(token.mid || data.mid), expiresAt: lifetime > 0 ? Date.now() + lifetime * 1000 : undefined, ...webCredentials(data) }, qr.generation);
      if (!saved) return { state: 'expired' };
    } else {
      const cookies = headers.getSetCookie().map(x => x.split(';')[0]);
      const cookie = cookies.join('; ');
      if (!cookie.includes('SESSDATA=')) throw new Error('网页登录未返回会话 Cookie，请重新扫码');
      const mid = cookies.find(x => x.startsWith('DedeUserID='))?.slice(11);
      await this.vault.update({ cookie, webMid: mid }, qr.generation);
      const snapshot = this.vault.generation;
      try { const nav = await this.http.get('https://api.bilibili.com/x/web-interface/nav'); await this.vault.update({ name: nav.uname, avatar: nav.face, webMid: String(nav.mid) }, snapshot); } catch { /* cookie remains usable; status can be retried by account APIs */ }
    }
    this.codes.delete(id); return { state: 'success', account: this.status() };
  }
  async accessKey() {
    const v = this.vault.value;
    if (!v.accessToken) throw new Error('请先连接 B 站 App 授权，启用 App 推荐');
    if (v.expiresAt && v.expiresAt < Date.now() + 600000 && v.refreshToken) {
      this.refresh ??= this.refreshToken().finally(() => { this.refresh = undefined; });
      await this.refresh;
    }
    const current = this.vault.value;
    if (!current.accessToken || (current.expiresAt && current.expiresAt <= Date.now())) throw new Error('App 授权已过期，请重新扫码');
    return current.accessToken;
  }
  private async refreshToken() {
    const { value: v, generation } = this.vault;
    for (const version of ['v3', 'v2']) {
      if (this.vault.generation !== generation) return false;
      try {
        const data = await this.http.get(`https://passport.bilibili.com/api/${version}/oauth2/refresh_token`, tvParams({ access_token: v.accessToken!, refresh_token: v.refreshToken!, ts: Math.floor(Date.now() / 1000) }), true, false);
        const token = data.token_info;
        if (!token?.access_token) continue;
        const cookiePatch = !v.cookie || v.appMid === v.webMid ? webCredentials(data) : {};
        return await this.vault.update({ accessToken: token.access_token, refreshToken: token.refresh_token || v.refreshToken, expiresAt: Date.now() + token.expires_in * 1000, ...cookiePatch }, generation);
      } catch { /* one bounded fallback to the other documented refresh endpoint */ }
    }
    return false;
  }
  web() { if (!this.vault.value.cookie) throw new Error('请先连接 B 站网页账号，以访问动态、历史、收藏和稍后再看'); }
  csrf() { this.web(); const csrf = /(?:^|;\s*)bili_jct=([^;]+)/.exec(this.vault.value.cookie!)?.[1]; if (!csrf) throw new Error('账号缺少 CSRF 凭证，请重新扫码'); return csrf; }
  async logout() { this.codes.clear(); await this.vault.clear(); return this.status(); }
}
