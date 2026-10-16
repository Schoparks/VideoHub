import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { copyFile, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import electron from 'electron';

if (process.env.YINGJI_LIVE_TEST !== '1') throw new Error('请明确启用 YINGJI_LIVE_TEST=1');
const bvid = process.env.YINGJI_ANDROID_BVID;
if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) throw new Error('请指定待检查的 BV 号');
// Supplying an account directory requires prior explicit user authorization.
const account = process.env.YINGJI_TEST_ACCOUNT_DIR;
const output = resolve('.tmp/bilibili-track-audit');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, 'profile-'));
const reportPath = join(output, account ? 'account.json' : 'anonymous.json');
const report = { bvid, status: 'running', authenticated: false, credentialsRemoved: false };
await writeFile(reportPath, JSON.stringify(report, null, 2));
try {
  const entry = join(output, 'audit.cjs');
  await build({ entryPoints: ['scripts/bilibili-track-audit-entry.ts'], bundle: true,
    platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], outfile: entry });
  if (account) for (const name of ['account.enc', 'Local State']) {
    await copyFile(join(account, name), join(profile, name));
  }
  const env = { ...process.env, YINGJI_AUDIT_PROFILE: profile, YINGJI_AUDIT_ACCOUNT: account ? '1' : '0' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(electron, [entry], { cwd: resolve('.'), env, windowsHide: true, stdio: 'ignore' });
    const timeout = setTimeout(() => child.kill(), 90000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolveExit(code); });
  });
  Object.assign(report, JSON.parse(await readFile(join(profile, 'track-report.json'), 'utf8')));
  if (code !== 0 || report.status !== 'complete') throw new Error('轨道信息检查未完成');
} catch {
  report.status = 'failed';
  process.exitCode = 1;
} finally {
  const names = ['account.enc', 'account.enc.tmp', 'Local State'];
  await Promise.allSettled(names.map(name => unlink(join(profile, name))));
  const files = await readdir(profile).catch(() => undefined);
  report.credentialsRemoved = !!files && !files.some(name => names.includes(name));
  if (!report.credentialsRemoved) {
    report.status = 'failed';
    process.exitCode = 1;
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
