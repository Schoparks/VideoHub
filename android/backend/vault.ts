import type { Credentials } from '../../electron/accounts/vault';
import { native, persist } from './native';

export class Vault {
  value: Credentials = {};
  generation = 0;
  warning?: string;
  get storage(): 'encrypted' | 'memory' { return native.secure() ? 'encrypted' : 'memory'; }
  async init() {
    if (!native.secure()) { this.warning = '系统密钥环不可用，账号仅保存在本次会话内。'; return; }
    try { this.value = JSON.parse(native.read('account') || '{}'); }
    catch { this.warning = '无法解密已保存的账号，请重新扫码。'; }
  }
  async update(patch: Credentials, expected = this.generation) {
    if (expected !== this.generation) return false;
    const next = { ...this.value, ...patch };
    if (native.secure()) persist('account', next);
    this.value = next;
    this.generation++;
    return true;
  }
  async clear() {
    if (native.secure()) persist('account', {});
    this.value = {};
    this.generation++;
  }
}
