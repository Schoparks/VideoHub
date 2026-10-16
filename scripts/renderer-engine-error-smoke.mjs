import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

// Fake engine interfaces exercise adapter callbacks and cleanup, not real decoding.
const core = `
function engine(kind) {
  const instance = { kind, disposed: false };
  window.engineAudit.instances.push(instance);
  return {
    updateSettings() {},
    initialize(video, url) { video.src = url; },
    loadSource(url) { instance.url = url; },
    attachMedia(video) { video.src = instance.url; },
    attachMediaElement(video) { instance.video = video; },
    load() { instance.video.src = instance.url; },
    on(_event, callback) { instance.fire = (fatal = true) => callback('error', { fatal }); },
    reset() { instance.disposed = true; },
    destroy() { instance.disposed = true; }
  };
}
`;
const modules = {
  hls: `
export default class Hls {
  static Events = { ERROR: 'error' };
  static isSupported() { return true; }
  constructor() { return engine('hls'); }
}
`,
  dash: `export function MediaPlayer() { return { create: () => engine('dash') }; }`,
  flv: `
const api = {
  Events: { ERROR: 'error' },
  isSupported: () => true,
  createPlayer(source) {
    const player = engine('flv');
    player.loadSource(source.url);
    return player;
  }
};
export default api;
export const m = { default: api };
`,
};
const output = resolve('.tmp/renderer-engine-error');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];

try {
  await page.route(/\/assets\/(?:hls|dash\.all\.min|mpegts)-[^/]+\.js$/, async route => {
    const url = route.request().url();
    const kind = url.includes('/hls-') ? 'hls' : url.includes('/mpegts-') ? 'flv' : 'dash';
    await route.fulfill({ contentType: 'text/javascript', body: core + modules[kind] });
  });
  await page.evaluate(() => {
    window.engineAudit = { instances: [], format: 'hls' };
    const resolve = window.hub.resolve;
    window.hub.resolve = async (...args) => ({ ...await resolve(...args), format: window.engineAudit.format });
  });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  for (const format of ['hls', 'dash', 'flv']) {
    await page.evaluate(format => { window.engineAudit.format = format; }, format);
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false);
    await page.locator('video').evaluate(video => { video.currentTime = 24.5; });
    if (format === 'hls') {
      await page.evaluate(() => window.engineAudit.instances.at(-1).fire(false));
      await page.waitForTimeout(80);
      assert.equal(await page.locator('.player-error').count(), 0);
      assert.equal(await page.locator('video').evaluate(video => video.paused), false);
      checks.push('nonfatal HLS callback preserves playback and does not expose a fatal error');
    }
    const instance = await page.evaluate(() => window.engineAudit.instances.length - 1);
    await page.evaluate(() => window.engineAudit.instances.at(-1).fire());
    await page.locator('.player-error').waitFor();
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.paused === false && !document.querySelector('.player-error'));
    assert.equal(await page.locator('video').evaluate(video => video.currentTime), 24.5);
    assert.equal(await page.evaluate(index => window.engineAudit.instances[index].disposed, instance), true);
    await page.evaluate(index => window.engineAudit.instances[index].fire(), instance);
    await page.waitForTimeout(80);
    assert.equal(await page.locator('.player-error').count(), 0);
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    checks.push(`${format} fatal callback pauses; retry keeps position, destroys the old engine and ignores its late error`);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
