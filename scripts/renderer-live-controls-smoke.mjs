import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-live-controls');
await mkdir(output, { recursive: true });
const checks = [];
for (const tvMode of [false, true]) {
  const viewport = tvMode ? { width: 1920, height: 1080 } : { width: 1440, height: 950 };
  const { page, errors, close } = await launchHeadlessRenderer(viewport, installReliabilityFixture);
  const label = tvMode ? 'TV' : 'desktop';
  const rate = () => page.locator('video').evaluate(video => video.playbackRate);
  const paused = () => page.locator('video').evaluate(video => video.paused);
  const live = async () => {
    await page.locator('.player[data-live="true"]').waitFor();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await rate(), 1);
    assert.equal(await page.getByRole('button', { name: '播放速度', exact: true }).count(), 0);
    assert.equal(await page.getByRole('slider', { name: '播放进度', exact: true }).count(), 0);
  };
  try {
    await page.evaluate(tvMode => {
      const state = window.reliability;
      const item = state.boot.queue[0];
      const room = { id: 'live:42', source: 'bilibili', kind: 'live', roomId: 42, title: '实时测试直播' };
      state.boot.preferences.tvMode = tvMode;
      state.boot.preferences.playbackRate = 2;
      state.boot.queue = [item, room, { ...item, id: 'bili:last', title: '后续点播' }];
      const originalResolve = window.hub.resolve;
      window.hub.resolve = async (...args) => {
        const source = await originalResolve(...args);
        // Same media-event fixture, with real source-kind boundaries and queue order.
        return { ...source, live: args[0].kind === 'live', parts: [], part: undefined,
          ...(args[0].kind === 'live' ? { qualities: [], quality: undefined } : {}) };
      };
      const originalBrowse = window.hub.browse;
      window.hub.browse = async request => request.kind === 'followingLive'
        ? { items: [room], hasMore: false } : originalBrowse(request);
    }, tvMode);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await rate(), 2);
    await page.getByRole('button', { name: '播放速度', exact: true }).click();
    await page.getByRole('dialog', { name: '播放速度', exact: true }).getByRole('button', { name: '1.25×', exact: true }).click();
    assert.equal(await rate(), 1.25);
    await connectPad(page);
    await pressPad(page, 5);
    await live();
    await page.screenshot({ path: resolve(output, tvMode ? 'television.png' : 'desktop.png') });
    checks.push(`${label}: point-of-use VOD speed is preserved but entering a live source uses normal speed`);

    assert.equal(await page.getByRole('button', { name: '清晰度', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '从头播放', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '显示弹幕', exact: true }).count(), 0);
    const resolves = await page.evaluate(() => window.reliability.resolves.length);
    for (const index of [4, 6, 7]) await pressPad(page, index);
    assert.equal(await page.locator('.player[data-seeking="true"]').count(), 0);
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), resolves);
    const hint = await page.locator('.player .controller-actions').innerText();
    assert.ok(!hint.includes('跳转 30 秒') && hint.includes('队列下一项'));
    checks.push(`${label}: live controls omit unavailable timeline, rate, replay and video-danmaku actions`);

    await pressPad(page, 9);
    assert.equal(await paused(), true);
    await pressPad(page, 1);
    await page.locator('.player:not(.controls-visible)').waitFor();
    assert.equal(await paused(), true);
    await pressPad(page, 12);
    await page.getByRole('button', { name: '继续播放', exact: true }).waitFor();
    await pressPad(page, 0);
    assert.equal(await paused(), false);
    assert.equal(await rate(), 1);
    checks.push(`${label}: live pause, B-hide and directional reveal/continue keep normal speed`);

    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await page.getByRole('combobox', { name: '默认播放速度', exact: true }).selectOption('0.75');
    await page.waitForFunction(() => window.reliability.boot.preferences.playbackRate === .75);
    assert.equal(await rate(), 1);
    await pressPad(page, 1);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: '播放设置', exact: true }).evaluate(node => node === document.activeElement), true);
    checks.push(`${label}: changing the default rate in settings does not alter the current live stream`);

    await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await live();
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), resolves + 1);
    checks.push(`${label}: retry reopens the original live source at normal speed`);

    await pressPad(page, 5);
    await page.locator('.player[data-live="false"]').waitFor();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await rate(), 1.25);
    assert.equal(await page.getByRole('button', { name: '播放速度', exact: true }).getAttribute('data-option-value'), '1.25');
    assert.ok((await page.locator('.player-overlay h2').innerText()).includes('后续点播'));
    assert.equal(await page.evaluate(() => window.reliability.boot.preferences.playbackRate), .75);
    checks.push(`${label}: queue order stays VOD/live/VOD and returning to VOD restores its temporary rate`);

    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.locator('.nav-item').filter({ hasText: '关注直播' }).click();
    await page.getByRole('button', { name: '播放 实时测试直播', exact: true }).click();
    await live();
    assert.equal(await page.evaluate(() => window.reliability.boot.preferences.playbackRate), .75);
    checks.push(`${label}: directly opening a following-live room ignores the VOD default without rewriting it`);

    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.locator('.nav-item').filter({ hasText: '首页' }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    assert.equal(await rate(), .75);
    assert.deepEqual(errors, []);
    checks.push(`${label}: reopening VOD applies the newly saved default; no page errors`);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
