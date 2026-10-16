import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export interface Credentials { cookie?: string; webMid?: string; name?: string; avatar?: string; accessToken?: string; refreshToken?: string; expiresAt?: number; refreshExpiresAt?: number; appMid?: string }
export interface Cipher { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
export class Vault {
  value: Credentials = {};
  generation = 0;
  warning?: string;
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory: string, readonly cipher: Cipher) {}
  get storage(): 'encrypted' | 'memory' { return this.cipher.available() ? 'encrypted' : 'memory'; }
  async init() {
    if (!this.cipher.available()) { this.warning = '系统密钥环不可用，账号仅保存在本次会话内。'; return; }
    try { this.value = JSON.parse(this.cipher.decrypt(await readFile(join(this.directory, 'account.enc')))); }
    catch (error: any) { if (error.code !== 'ENOENT') this.warning = '无法解密已保存的账号，请重新扫码。'; }
  }
  async update(patch: Credentials, expected = this.generation) {
    if (expected !== this.generation) return false;
    this.value = { ...this.value, ...patch }; this.generation++;
    await this.persist(); return true;
  }
  private persist(clear = false) {
    const snapshot = this.value;
    const write = this.writes.catch(() => {}).then(async () => {
      const file = join(this.directory, 'account.enc');
      if (clear) { await unlink(file).catch((e) => { if (e.code !== 'ENOENT') throw e; }); return; }
      if (!this.cipher.available()) return;
      await writeFile(`${file}.tmp`, this.cipher.encrypt(JSON.stringify(snapshot)), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    this.writes = write; return write;
  }
  async clear() { this.generation++; this.value = {}; await this.persist(true); }
}
