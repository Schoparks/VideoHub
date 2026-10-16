import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-restart-preview');
await mkdir(output, { recursive: true });
const checks = [];
for (const tvMode of [false, true]) {
  const { page, errors, close } = await launchHeadlessRenderer(tvMode
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const label = tvMode ? 'TV / remapped' : 'desktop';
  const pauseButton = tvMode ? 8 : 9;
  const media = () => page.locator('video').evaluate(video => ({
    position: video.currentTime, paused: video.paused, rate: video.playbackRate,
  }));
  const draft = async () => {
    await pressPad(page, 6);
    await page.locator('.player[data-seeking="true"]').waitFor();
  };
  const completed = async () => {
    await page.locator('video').evaluate(video => {
      video.currentTime = 120;
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await page.getByRole('button', { name: '重新播放', exact: true }).waitFor();
  };
  const expectRestart = async () => {
    assert.deepEqual(await media(), { position: 0, paused: false, rate: 1.5 });
    assert.equal(await page.locator('.player').getAttribute('data-seeking'), 'false', 'explicit restart must discard the old jump draft');
    assert.equal(await page.locator('.seek-preview').count(), 0);
    assert.equal(await page.locator('.player').getAttribute('data-ended'), 'false');
    assert.equal(await page.evaluate(() => window.reliability.resolves.length), 1);
    assert.equal(await page.getByRole('button', { name: '清晰度', exact: true }).getAttribute('data-option-value'), '80');
  };
  try {
    await page.evaluate(({ tvMode, pauseButton }) => {
      window.reliability.boot.preferences.tvMode = tvMode;
      window.reliability.boot.preferences.playbackRate = 1.5;
      window.reliability.boot.preferences.gamepadMap.pause = pauseButton;
    }, { tvMode, pauseButton });
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);

    await page.locator('video').evaluate(video => { video.currentTime = 40; });
    await draft();
    await page.getByRole('button', { name: '从头播放', exact: true }).click();
    await expectRestart();
    checks.push(`${label}: explicit from-head restart discards an unconfirmed draft and stays in the same session, quality and rate`);
    await page.getByRole('button', { name: '暂停', exact: true }).focus();
    await pressPad(page, 0);
    assert.deepEqual(await media(), { position: 0, paused: true, rate: 1.5 });
    assert.equal(await page.locator('.seek-preview').count(), 0);
    checks.push(`${label}: A after restart acts on the focused pause control instead of committing the abandoned position`);

    await completed();
    await draft();
    await pressPad(page, pauseButton);
    await expectRestart();
    checks.push(`${label}: the actual pause/replay mapping clears an ended-video draft before starting from zero`);

    await completed();
    await draft();
    await page.getByRole('button', { name: '重新播放', exact: true }).click();
    await expectRestart();
    await page.screenshot({ path: resolve(output, tvMode ? 'television.png' : 'desktop.png') });
    checks.push(`${label}: pointer replay of completed media has the same draft cleanup and completion reset`);

    await page.locator('video').evaluate(video => { video.currentTime = 40; });
    await draft();
    await pressPad(page, pauseButton);
    assert.deepEqual(await media(), { position: 40, paused: true, rate: 1.5 });
    assert.equal(await page.locator('.player').getAttribute('data-seeking'), 'true');
    await pressPad(page, 1);
    assert.deepEqual(await media(), { position: 40, paused: true, rate: 1.5 });
    await draft();
    await pressPad(page, 0);
    assert.deepEqual(await media(), { position: 10, paused: true, rate: 1.5 });
    checks.push(`${label}: ordinary pause keeps the draft; B cancels without seeking and A later commits while keeping pause`);

    await draft();
    await pressPad(page, pauseButton);
    assert.deepEqual(await media(), { position: 10, paused: false, rate: 1.5 });
    assert.equal(await page.locator('.player').getAttribute('data-seeking'), 'true');
    await pressPad(page, 1);
    assert.deepEqual(await media(), { position: 10, paused: false, rate: 1.5 });
    assert.equal(await page.locator('.player').getAttribute('data-seeking'), 'false');
    assert.deepEqual(errors, []);
    checks.push(`${label}: ordinary continue also preserves the preview until explicit cancel, without changing position or source`);
  } catch (error) {
    await writeFile(resolve(output, 'failure.json'), JSON.stringify({ message: error.message, media: await media(),
      seeking: await page.locator('.player').getAttribute('data-seeking') }, null, 2));
    throw error;
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
