import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-pointer-idle');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const visible = () => page.locator('.player').evaluate(player => player.classList.contains('controls-visible'));
  const point = async selector => {
    const bounds = await page.locator(selector).boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  };
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.locator('video').evaluate(video => { video.currentTime = 40; });
    await point('[aria-label="播放速度"]');
    await page.waitForTimeout(5300);
    const observation = { visible: await visible(), paused: await page.locator('video').evaluate(video => video.paused) };
    await writeFile(resolve(output, `${mode}-idle.json`), JSON.stringify(observation));
    assert.equal(observation.visible, true);
    assert.equal(observation.paused, false);
    await page.mouse.down();
    await page.mouse.up();
    await page.getByRole('dialog', { name: '播放速度', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    checks.push(`${mode}: stationary pointer over speed keeps controls visible and its later click opens the menu`);

    await point('.timeline');
    await page.waitForTimeout(5300);
    assert.equal(await visible(), true);
    await page.mouse.move(700, 400);
    await page.locator('.player:not(.controls-visible)').waitFor({ timeout: 7000 });
    checks.push(`${mode}: pointer on the timeline prevents hiding; leaving the control area restarts normal timeout hiding`);

    await page.mouse.move(700, 401);
    await page.locator('.player.controls-visible').waitFor();
    await point('.player-overlay h2');
    await page.waitForTimeout(5300);
    assert.equal(await visible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await visible(), false);
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    checks.push(`${mode}: reading the title with a stationary pointer keeps it visible; explicit B/Escape still hides`);

    await page.mouse.move(710, 400);
    await page.locator('.player.controls-visible').waitFor();
    await point('[aria-label="清晰度"]');
    await connectPad(page);
    await pressPad(page, 13);
    await page.locator('.player:not(.controls-visible)').waitFor({ timeout: 7000 });
    checks.push(`${mode}: controller input clears pointer retention so idle controls can hide again`);

    await pressPad(page, 12);
    await page.locator('.player.controls-visible').waitFor();
    await point('[aria-label="清晰度"]');
    await page.keyboard.press('Tab');
    await page.locator('.player:not(.controls-visible)').waitFor({ timeout: 7000 });
    checks.push(`${mode}: native keyboard navigation clears pointer retention without requiring another mouse move`);

    await page.mouse.move(700, 400);
    await page.locator('.player.controls-visible').waitFor();
    await point('[aria-label="播放设置"]');
    await page.mouse.down();
    await page.mouse.up();
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
    assert.equal(await page.locator('.player').getAttribute('inert'), '');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.locator('.player:not(.controls-visible)').waitFor({ timeout: 7000 });
    assert.equal(await page.locator('video').evaluate(video => video.paused), false);
    checks.push(`${mode}: settings remains isolated and keyboard return restores ordinary idle hiding`);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(output, `${mode}.png`) });
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
