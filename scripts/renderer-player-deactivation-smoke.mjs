import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-deactivation');
await mkdir(output, { recursive: true });
const checks = [];
const observations = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const slider = page.getByRole('slider', { name: '播放进度', exact: true });
  const state = () => page.evaluate(() => ({
    visible: document.querySelector('.player').classList.contains('controls-visible'),
    seeking: document.querySelector('.player').dataset.seeking,
    position: document.querySelector('video').currentTime,
    paused: document.querySelector('video').paused,
  }));
  const deactivate = () => page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const visibility = hidden => page.evaluate(hidden => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.locator('video').evaluate(video => { video.currentTime = 40; });
    const speed = await page.locator('[aria-label="播放速度"]').boundingBox();
    await page.mouse.move(speed.x + speed.width / 2, speed.y + speed.height / 2);
    await deactivate();
    await page.waitForTimeout(5300);
    const idle = await state();

    await page.mouse.move(700, 400);
    await page.locator('.player.controls-visible').waitFor();
    const bounds = await slider.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .75, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.locator('.player[data-seeking="true"]').waitFor();
    await deactivate();
    const interrupted = await state();
    await page.mouse.up();
    const released = await state();
    observations.push({ mode, idle, interrupted, released });
    await writeFile(resolve(output, 'observations.json'), JSON.stringify(observations, null, 2));
    assert.equal(idle.visible, false);
    assert.equal(idle.paused, false);
    checks.push(`${mode}: simulated window blur releases stationary-pointer retention without pausing`);
    assert.equal(interrupted.seeking, 'false');
    assert.equal(released.position, 40);
    assert.equal(released.seeking, 'false');
    checks.push(`${mode}: interrupted pointer preview cancels; a later release cannot seek`);

    await connectPad(page);
    await slider.focus();
    await pressPad(page, 15);
    assert.equal(await slider.inputValue(), '50');
    await deactivate();
    assert.equal((await state()).seeking, 'true');
    assert.equal((await state()).position, 40);
    await page.evaluate(() => { window.testPad.buttons[0] = { pressed: true, value: 1 }; });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(150);
    assert.equal((await state()).position, 40);
    assert.equal((await state()).seeking, 'true');
    await page.evaluate(() => { window.testPad.buttons[0] = { pressed: false, value: 0 }; });
    await page.waitForTimeout(150);
    await pressPad(page, 0);
    assert.equal((await state()).position, 50);
    assert.equal((await state()).seeking, 'false');
    checks.push(`${mode}: non-pointer preview survives blur; held A on regain is ignored until neutral and a fresh confirmation`);

    await page.mouse.move(speed.x + speed.width / 2, speed.y + speed.height / 2);
    await visibility(true);
    await visibility(false);
    await page.waitForTimeout(5300);
    assert.equal((await state()).visible, false);
    assert.equal((await state()).paused, false);
    checks.push(`${mode}: simulated hidden/visible transition also releases stale mouse retention`);

    await page.mouse.move(700, 401);
    await page.locator('.player.controls-visible').waitFor();
    await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.locator('.player[data-seeking="true"]').waitFor();
    await visibility(true);
    await page.locator('.player[data-seeking="false"]').waitFor();
    await visibility(false);
    await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height / 2);
    await page.mouse.up();
    await writeFile(resolve(output, `${mode}-visibility-release.json`), JSON.stringify(await state()));
    assert.equal((await state()).position, 50);
    assert.equal((await state()).seeking, 'false');
    checks.push(`${mode}: hidden/visible transition cancels the entire held drag, including further movement and late release`);

    await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.locator('.player[data-seeking="true"]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.player[data-seeking="false"]').waitFor();
    await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height / 2);
    await page.mouse.up();
    assert.equal((await state()).position, 50);
    assert.equal((await state()).seeking, 'false');
    await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    assert.ok(Math.abs((await state()).position - 30) < 2);
    assert.equal((await state()).paused, false);
    await page.locator('video').evaluate(video => { video.currentTime = 50; });
    checks.push(`${mode}: B cancels an entire held drag; only a new press starts a fresh usable pointer seek`);

    await slider.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal((await state()).seeking, 'true');
    const draft = await slider.inputValue();
    await visibility(true);
    await visibility(false);
    assert.equal(await slider.inputValue(), draft);
    assert.equal((await state()).position, 50);
    await page.keyboard.press('Escape');
    assert.equal((await state()).seeking, 'false');
    assert.equal((await state()).position, 50);
    checks.push(`${mode}: keyboard preview remains provisional across visibility changes and Escape still cancels`);

    await page.mouse.move(speed.x + speed.width / 2, speed.y + speed.height / 2);
    await page.waitForTimeout(5300);
    assert.equal((await state()).visible, true);
    await page.mouse.down();
    await page.mouse.up();
    await page.getByRole('dialog', { name: '播放速度', exact: true }).waitFor();
    await deactivate();
    await page.getByRole('dialog', { name: '播放速度', exact: true }).waitFor();
    assert.equal((await state()).paused, false);
    await page.keyboard.press('Escape');
    checks.push(`${mode}: fresh mouse movement restores retention; an open parameter menu survives deactivation without applying changes`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
