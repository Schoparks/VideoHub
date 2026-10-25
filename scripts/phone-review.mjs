import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installPhoneCompanion } from './phone-companion-fixture.mjs';

// Clearly named sample content for UI review only. No real account, platform or media requests.
const install = new Function(`(${installPhoneCompanion})();
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: 'review:' + index, source: 'bilibili', kind: 'video', aid: 42 + index,
    title: '界面预览 · 示例视频 ' + String(index + 1).padStart(2, '0'),
    author: '隔离样例', duration: 120, cover: 'https://i0.hdslb.com/bfs/archive/review' + index + '.jpg',
  }));
  window.hub.browse = async () => ({ items, hasMore: false });
  window.hub.related = async () => ({ items: items.slice(1, 5), hasMore: false });
  window.reliability.boot.history = items.slice(0, 4).map(item => ({ item, position: 42, duration: 120, updatedAt: Date.now() }));
  const palettes = [['#233e52', '#7c9f99'], ['#5c4368', '#c5a69b'], ['#4b5c43', '#a4b18e'], ['#a27756', '#e4c2a0']];
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    if (!String(args[0]).startsWith('yingji://app/image?')) return originalFetch(...args);
    const index = Number(String(args[0]).match(/review(\\d)/)?.[1] || 0);
    const palette = palettes[index % palettes.length];
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 640, 360);
    gradient.addColorStop(0, palette[0]); gradient.addColorStop(1, palette[1]);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#ffffff22'; ctx.beginPath(); ctx.arc(500, 85, 110, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0b182e55'; ctx.beginPath(); ctx.moveTo(0, 290); ctx.lineTo(230, 140);
    ctx.lineTo(410, 310); ctx.lineTo(640, 210); ctx.lineTo(640, 360); ctx.lineTo(0, 360); ctx.fill();
    ctx.fillStyle = '#ffffffcc'; ctx.font = '22px sans-serif'; ctx.fillText('界面预览', 32, 48);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
    return new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } });
  };
`);
const output = resolve('.tmp/phone-review');
await mkdir(output, { recursive: true });
await build({ entryPoints: ['electron/remote/server.ts'], bundle: true, platform: 'node', format: 'esm', outfile: `${output}/server.mjs` });
const { ControllerServer } = await import(pathToFileURL(`${output}/server.mjs`).href);
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, install);
const pending = new Map();
const server = new ControllerServer(resolve('dist-electron/remote'), command => new Promise((resolveReply, reject) => {
  const id = randomUUID(); pending.set(id, resolveReply);
  void page.evaluate(request => window.receiveController(request), { id, command }).catch(reject);
}));
let context;
try {
  await page.exposeFunction('phoneReply', (id, reply) => { pending.get(id)?.(reply); pending.delete(id); });
  await page.exposeFunction('phoneStatus', () => server.start());
  await server.start();
  await page.waitForFunction(() => !!window.receiveController);
  const url = new URL(server.status().urls[0]); url.hostname = '127.0.0.1';
  context = await page.context().browser().newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const phone = await context.newPage();
  const failures = [];
  const covers = [];
  phone.on('response', async response => {
    if (!response.url().endsWith('/command')) return;
    const reply = await response.json().catch(() => ({}));
    if (response.request().postDataJSON().kind === 'cover') covers.push({ handle: response.request().postDataJSON().handle, bytes: reply.image?.length, error: reply.error });
    if (reply.error) failures.push({ command: response.request().postDataJSON(), error: reply.error });
  });
  await phone.goto(url.href);
  await phone.getByRole('button', { name: '播放 界面预览 · 示例视频 01', exact: true }).waitFor();
  await phone.waitForFunction(() => document.querySelectorAll('.phone-cover img').length >= 8);
  await phone.screenshot({ path: `${output}/home.png` });
  await phone.getByRole('button', { name: '打开搜索', exact: true }).click();
  await phone.screenshot({ path: `${output}/search.png` });
  await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
  await phone.getByRole('button', { name: '工具', exact: true }).click();
  await phone.screenshot({ path: `${output}/tools.png` });
  await phone.getByRole('button', { name: '设置', exact: true }).click();
  await phone.screenshot({ path: `${output}/settings.png` });
  await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
  await phone.getByRole('button', { name: '历史记录', exact: true }).click();
  await phone.getByRole('dialog').getByRole('button', { name: '播放 界面预览 · 示例视频 01', exact: true }).waitFor();
  await phone.screenshot({ path: `${output}/history.png` });
  await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
  await phone.getByRole('button', { name: '播放 界面预览 · 示例视频 01', exact: true }).click();
  await phone.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await phone.screenshot({ path: `${output}/player.png` });
  await phone.getByRole('button', { name: '返回首页', exact: true }).click();
  await phone.getByRole('button', { name: '打开播放遥控器', exact: true }).waitFor();
  await phone.screenshot({ path: `${output}/bubble.png` });
  await writeFile(`${output}/report.json`, JSON.stringify({ fixture: 'isolated UI samples', errors, failures, covers, images: ['home', 'search', 'tools', 'settings', 'history', 'player', 'bubble'] }, null, 2));
  console.log(JSON.stringify({ output, errors }));
} finally {
  await context?.close(); await server.stop(); await close();
}
