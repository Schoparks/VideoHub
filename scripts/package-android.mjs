import { spawn } from 'node:child_process';
import { mkdir, copyFile, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const sdk = resolve(process.env.ANDROID_HOME || '.tmp/android-tools/sdk');
const buildTools = process.env.YINGJI_ANDROID_BUILD_TOOLS || '35.0.0';
let tools = join(sdk, 'build-tools', buildTools);
try { await stat(tools); } catch { tools = join(sdk, 'android-15'); }
let platform = join(sdk, 'platforms', 'android-35', 'android.jar');
try { await stat(platform); } catch { platform = join(sdk, 'android-35', 'android.jar'); }
const output = resolve('.tmp/android-build');
const manifestSource = await readFile('android/AndroidManifest.xml', 'utf8');
const version = /android:versionName="([\d.]+)-tv"/.exec(manifestSource)?.[1];
if (!version) throw new Error('Android manifest version is missing');
const apkName = `yingji-tv-${version}.apk`;
const testing = process.env.YINGJI_ANDROID_TEST === '1';
const release = resolve(testing ? '.tmp/android-test' : 'release/android-tv');
const windows = process.platform === 'win32';
const executable = name => join(tools, name + (windows ? '.exe' : ''));
async function run(command, args) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}
await run(process.execPath, ['scripts/android-web.mjs']);
for (const name of ['res/drawable', 'compiled', 'classes', 'dex']) await mkdir(join(output, name), { recursive: true });
await mkdir(release, { recursive: true });
await copyFile('public/app-icon-512.png', join(output, 'res/drawable/app_icon.png'));
// The banner is generated from our existing icon and brand, using a hidden browser.
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, channel: windows ? 'msedge' : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 180 }, deviceScaleFactor: 1 });
  const icon = (await readFile('public/app-icon-512.png')).toString('base64');
  await page.setContent(`<html><body style="margin:0;background:#16191f;display:flex;align-items:center;justify-content:center;height:180px;color:#f5f6f8;font:600 38px sans-serif;gap:18px"><img width="76" height="76" src="data:image/png;base64,${icon}"/><span>映集</span></body></html>`);
  await page.screenshot({ path: join(output, 'res/drawable/tv_banner.png') });
} finally { await browser.close(); }
await run(executable('aapt2'), ['compile', '--dir', join(output, 'res'), '-o', join(output, 'compiled')]);
const resources = (await walk(join(output, 'compiled'))).filter(file => file.endsWith('.flat'));
const unsigned = join(output, 'unsigned.apk');
let manifest = resolve('android/AndroidManifest.xml');
if (testing) {
  manifest = join(output, 'test-manifest.xml');
  await writeFile(manifest, manifestSource.replace('<application ', '<application android:debuggable="true" '));
}
await run(executable('aapt2'), ['link', '-o', unsigned, '-I', platform, '--manifest', manifest,
  '--min-sdk-version', '28', '--target-sdk-version', '35', ...resources]);
const sources = (await walk(resolve('android/java'))).filter(file => file.endsWith('.java'));
const javaHome = process.env.JAVA_HOME;
const java = name => javaHome ? join(javaHome, 'bin', name + (windows ? '.exe' : '')) : name;
// AAPT2 on Windows emits backslashes in nested asset ZIP names. JAR uses portable '/' entries.
await run(java('jar'), ['--update', '--file', unsigned, '--no-manifest', '-C', output, 'assets']);
await run(java('javac'), ['-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', platform,
  '-d', join(output, 'classes'), ...sources]);
const classes = (await walk(join(output, 'classes'))).filter(file => file.endsWith('.class'));
await run(java('java'), ['-cp', join(tools, 'lib/d8.jar'), 'com.android.tools.r8.D8', '--min-api', '28',
  '--lib', platform, '--output', join(output, 'dex'), ...classes]);
// SDK aapt adds the DEX payload without third-party ZIP tooling.
const dex = (await walk(join(output, 'dex'))).filter(file => file.endsWith('.dex'));
for (const file of dex) await copyFile(file, join(output, file.split(/[\\/]/).pop()));
await new Promise((resolveRun, reject) => {
  const child = spawn(executable('aapt'), ['add', 'unsigned.apk', ...dex.map(file => file.split(/[\\/]/).pop())],
    { cwd: output, stdio: 'inherit', windowsHide: true });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolveRun() : reject(new Error('DEX packaging failed')));
});
const aligned = join(output, 'aligned.apk');
await run(executable('zipalign'), ['-f', '-p', '4', unsigned, aligned]);
const key = resolve(process.env.YINGJI_ANDROID_KEYSTORE || '.tmp/android-signing/development.p12');
if (!process.env.YINGJI_ANDROID_KEYSTORE) {
  await mkdir(resolve('.tmp/android-signing'), { recursive: true });
  try { await stat(key); } catch {
    await run(java('keytool'), ['-genkeypair', '-keystore', key, '-storetype', 'PKCS12', '-alias', 'yingji-tv',
      '-storepass', 'android', '-keypass', 'android', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
      '-dname', 'CN=Yingji TV Development,O=VideoHub,C=CN']);
  }
}
const apk = join(release, apkName);
const signer = ['-jar', join(tools, 'lib/apksigner.jar')];
const signing = process.env.YINGJI_ANDROID_KEYSTORE ? ['--ks-pass', 'env:YINGJI_ANDROID_KEYSTORE_PASSWORD'] : ['--ks-pass', 'pass:android'];
await run(java('java'), [...signer, 'sign', '--ks', key, ...signing, '--out', apk, aligned]);
await run(java('java'), [...signer, 'verify', '--verbose', '--print-certs', apk]);
await run(executable('aapt'), ['dump', 'badging', apk]);
const sha256 = createHash('sha256').update(await readFile(apk)).digest('hex');
await writeFile(join(release, `${apkName}.sha256`), `${sha256}  ${apkName}\n`);
console.log(`APK: ${apk}\nSHA256: ${sha256}`);
