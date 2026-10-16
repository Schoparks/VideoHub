import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-part-discovery');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const next = page.locator('[data-player-action="next"]');
  const play = async () => {
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  };
  const exit = async () => {
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
  };
  const idle = () => page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false');
  try {
    await page.evaluate(tv => {
      const state = window.reliability;
      state.boot.preferences.tvMode = tv;
      const item = state.boot.queue[0];
      state.boot.queue = [];
      state.omitParts = true;
      state.partsOverride = [{ id: 'cid:2', cid: 2, title: '唯一一集' }];
      state.detailOverride = { item, parts: state.partsOverride, description: '' };
      state.discoveryCalls = 0;
      const detail = window.hub.detail;
      window.hub.detail = async (...args) => {
        state.discoveryCalls++;
        if (state.failDiscovery) throw new Error('分集读取失败');
        return detail(...args);
      };
    }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await play();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '播放速度', exact: true }).click();
    await page.getByRole('dialog', { name: '播放速度', exact: true })
      .getByRole('button', { name: '2×', exact: true }).click();
    await page.locator('video').evaluate(video => { video.currentTime = 37.5; });
    const session = await page.evaluate(() => window.reliability.resolves.at(-1).sessionId);
    await page.evaluate(() => {
      window.reliability.discoveryEvents = [];
      const video = document.querySelector('video');
      for (const type of ['pause', 'playing', 'loadedmetadata']) {
        video.addEventListener(type, () => window.reliability.discoveryEvents.push(type));
      }
    });
    await next.evaluate(button => button.click());
    await page.waitForFunction(() => window.reliability.discoveryCalls === 1
      && document.querySelector('.player')?.dataset.switching === 'false');
    const observation = await next.evaluate(button => ({
      disabled: button.disabled, label: button.getAttribute('aria-label'),
      calls: window.reliability.discoveryCalls,
    }));
    await writeFile(resolve(output, `${mode}-known.json`), JSON.stringify(observation));
    assert.equal(observation.disabled, true);
    assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).sessionId), session);
    assert.deepEqual(await page.locator('video').evaluate(video => ({
      paused: video.paused, position: video.currentTime, rate: video.playbackRate,
    })), { paused: true, position: 37.5, rate: 2 });
    assert.deepEqual(await page.evaluate(() => window.reliability.discoveryEvents), []);
    await connectPad(page);
    await page.getByRole('button', { name: '播放速度', exact: true }).focus();
    await pressPad(page, 5);
    assert.equal(await page.evaluate(() => window.reliability.discoveryCalls), 1);
    assert.equal(await page.getByRole('button', { name: '播放速度', exact: true })
      .evaluate(button => document.activeElement === button), true);
    checks.push(`${mode}: discovering no successor updates availability and avoids repeated detail reads`);
    checks.push(`${mode}: same-session metadata updates preserve paused position, rate and media lifecycle`);

    await exit();
    await page.evaluate(() => {
      const state = window.reliability;
      state.partsOverride = undefined;
      state.detailOverride = undefined;
      state.discoveryCalls = 0;
    });
    await play();
    await next.evaluate(button => button.click());
    await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:2'
      && document.querySelector('.player')?.dataset.switching === 'false');
    assert.equal(await next.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '上一集', exact: true }).isDisabled(), false);
    await page.getByRole('button', { name: '选集，共 2 集', exact: true }).click();
    assert.equal(await page.locator('.episode-option').count(), 2);
    await page.getByRole('button', { name: '关闭选集', exact: true }).click();
    checks.push(`${mode}: resolved episode metadata survives omitted parts in a new session and enables the full episode menu`);

    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.locator('video').evaluate(video => { video.currentTime = 18.25; });
    await page.getByRole('button', { name: '清晰度', exact: true }).click();
    await page.getByRole('dialog', { name: '清晰度', exact: true })
      .getByRole('button', { name: '720P', exact: true }).click();
    await page.waitForFunction(() => window.reliability.resolves.at(-1).quality === 64
      && document.querySelector('.player')?.dataset.switching === 'false');
    assert.equal(await next.isDisabled(), true);
    assert.deepEqual(await page.locator('video').evaluate(video => ({ paused: video.paused, position: video.currentTime })),
      { paused: true, position: 18.25 });
    assert.equal(await page.evaluate(() => window.reliability.discoveryCalls), 1);
    await page.getByRole('button', { name: '上一集', exact: true }).click();
    await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:1'
      && document.querySelector('.player')?.dataset.switching === 'false');
    assert.equal(await next.getAttribute('aria-label'), '下一集');
    await next.evaluate(button => button.click());
    await idle();
    assert.equal(await page.evaluate(() => window.reliability.discoveryCalls), 1);
    checks.push(`${mode}: quality changes preserve accurate episode availability and pause/position; repeated succession uses confirmed parts`);

    await exit();
    await page.evaluate(() => { window.reliability.failDiscovery = true; });
    await play();
    await next.evaluate(button => button.click());
    await page.getByText('分集读取失败', { exact: true }).waitFor();
    await idle();
    assert.equal(await next.isDisabled(), false);
    assert.equal(await next.getAttribute('aria-label'), '下一项');
    await page.evaluate(() => { window.reliability.failDiscovery = false; });
    await next.evaluate(button => button.click());
    await page.waitForFunction(() => window.reliability.resolves.at(-1).part === 'cid:2'
      && document.querySelector('.player')?.dataset.switching === 'false');
    assert.equal(await next.isDisabled(), true);
    checks.push(`${mode}: failed episode discovery remains retryable and only success updates known metadata`);

    await exit();
    await page.evaluate(() => { window.reliability.holdDetail = true; });
    await play();
    await next.evaluate(button => button.click());
    await page.waitForFunction(() => !!window.reliability.finishDetail);
    const before = await page.evaluate(() => window.reliability.resolves.length);
    await exit();
    await play();
    await page.evaluate(() => {
      window.reliability.holdDetail = false;
      window.reliability.finishDetail();
    });
    await page.waitForTimeout(150);
    await idle();
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), before + 1);
    assert.equal(await next.getAttribute('aria-label'), '下一项');
    assert.equal(await next.isDisabled(), false);
    checks.push(`${mode}: exiting cancels discovery and its late result cannot update a newly opened player`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
