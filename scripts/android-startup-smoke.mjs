import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const serial = process.env.YINGJI_ANDROID_SERIAL;
if (!serial?.startsWith('emulator-')) throw new Error('必须显式指定本次隔离模拟器 YINGJI_ANDROID_SERIAL');
const sdk = process.env.ANDROID_HOME || resolve('.tmp/android-tools/sdk');
const adb = resolve(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const output = resolve('.tmp/android-startup-smoke');
const execute = promisify(execFile);
const run = async (...args) => (await execute(adb, ['-s', serial, ...args], { windowsHide: true, encoding: 'buffer' })).stdout;
const text = async (...args) => (await run(...args)).toString();
const delay = duration => new Promise(done => setTimeout(done, duration));
const key = async code => { await run('shell', 'input', 'keyevent', String(code)); await delay(200); };
const launch = async () => {
  await run('shell', 'am', 'force-stop', 'app.yingji.tv');
  await run('shell', 'am', 'start', '-n', 'app.yingji.tv/.MainActivity');
  await delay(1500);
};
const hierarchy = async () => {
  await run('shell', 'uiautomator', 'dump', '/data/local/tmp/yingji-startup.xml');
  return text('shell', 'cat', '/data/local/tmp/yingji-startup.xml');
};
await mkdir(output, { recursive: true });
await writeFile(`${output}/report.json`, JSON.stringify({ status: 'running', serial }));
const current = await text('shell', 'dumpsys', 'webviewupdate');
const provider = /Current WebView package \(name, version\): \(([^,]+),/.exec(current)?.[1];
assert.ok(['com.google.android.webview', 'com.android.webview'].includes(provider), 'only known provider on explicit emulator');
const checks = [];
try {
  try {
    await run('shell', 'pm', 'disable-user', '--user', '0', provider);
    await launch();
    let xml = await hierarchy();
    assert.ok(xml.includes('无法启动映集') && xml.includes('Android：') && xml.includes('WebView：'));
    assert.ok(xml.includes('未检测到可用组件'));
    assert.ok(/text="重试"[^>]*focused="true"/.test(xml));
    checks.push('missing WebView shows native Android/version diagnostics and focuses retry');
    await writeFile(`${output}/missing-webview.png`, await run('exec-out', 'screencap', '-p'));
    await key(22);
    xml = await hierarchy();
    assert.ok(/text="退出"[^>]*focused="true"/.test(xml));
    await key(21);
    await key(23);
    await delay(500);
    xml = await hierarchy();
    assert.ok(/text="重试"[^>]*focused="true"/.test(xml));
    checks.push('native D-pad and center retry remain usable without JavaScript');
    await key(22);
    await key(23);
    const activity = await text('shell', 'dumpsys', 'activity', 'activities');
    assert.ok(!/topResumedActivity=.*app\.yingji\.tv/.test(activity));
    checks.push('native exit works from startup failure');
  } finally {
    await run('shell', 'pm', 'enable', '--user', '0', provider);
    await launch();
  }
  await delay(3000);
  await key(82);
  await delay(700);
  const restored = await hierarchy();
  assert.ok(restored.includes('android.webkit.WebView') && !restored.includes('无法启动映集'));
  await writeFile(`${output}/restored-menu.png`, await run('exec-out', 'screencap', '-p'));
  checks.push('provider restored; final release APK shows WebView; menu screenshot captured for visual verification');
  const report = { passed: true, serial, checks };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ status: 'failed', serial, error: error.message }));
  throw error;
}
