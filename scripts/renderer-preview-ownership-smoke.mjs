import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-preview-ownership');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const slider = page.getByRole('slider', { name: '播放进度', exact: true });
  const state = () => page.evaluate(() => ({
    position: document.querySelector('video').currentTime,
    seeking: document.querySelector('.player').dataset.seeking,
    paused: document.querySelector('video').paused,
    draft: document.querySelector('.timeline').value,
  }));
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);
    await page.locator('video').evaluate(video => { video.currentTime = 40; });
    await page.getByRole('button', { name: '暂停', exact: true }).focus();
    await pressPad(page, 7);
    assert.equal((await state()).draft, '70');
    await page.mouse.move(700, 400);
    await page.mouse.down();
    const bounds = await slider.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height / 2);
    await page.mouse.up();
    const observation = await state();
    await writeFile(resolve(output, `${mode}-foreign-release.json`), JSON.stringify(observation));
    assert.equal(observation.position, 40);
    assert.equal(observation.seeking, 'true');
    assert.equal(observation.draft, '70');
    await pressPad(page, 0);
    assert.equal((await state()).position, 70);
    assert.equal((await state()).seeking, 'false');
    checks.push(`${mode}: releasing a pointer pressed outside the timeline cannot commit a controller preview; A still commits`);

    await page.locator('.player-overlay h2').focus();
    await page.keyboard.press('[');
    assert.equal((await state()).draft, '40');
    await slider.dispatchEvent('pointercancel', { pointerId: 77 });
    assert.equal((await state()).seeking, 'true');
    assert.equal((await state()).draft, '40');
    assert.equal((await state()).position, 70);
    await page.keyboard.press('Enter');
    assert.equal((await state()).position, 40);
    checks.push(`${mode}: an unrelated pointer cancellation leaves the keyboard preview provisional until Enter`);

    await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.locator('.player[data-seeking="true"]').waitFor();
    const ownedDraft = (await state()).draft;
    await slider.dispatchEvent('pointerup', { pointerId: 99 });
    await slider.dispatchEvent('pointercancel', { pointerId: 99 });
    assert.equal((await state()).draft, ownedDraft);
    assert.equal((await state()).seeking, 'true');
    assert.equal((await state()).position, 40);
    await page.mouse.up();
    assert.ok(Math.abs((await state()).position - 30) < 2);
    assert.equal((await state()).seeking, 'false');
    checks.push(`${mode}: a different pointer cannot release or cancel an owned drag; the original release commits`);

    const dragged = (await state()).position;
    await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.locator('.player[data-seeking="true"]').waitFor();
    await slider.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.locator('.player[data-seeking="false"]').waitFor();
    await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height / 2);
    await page.mouse.up();
    assert.equal((await state()).position, dragged);
    assert.equal((await state()).seeking, 'false');
    checks.push(`${mode}: cancellation of the original pointer discards its whole gesture, including continued movement`);

    await page.getByRole('button', { name: '暂停', exact: true }).focus();
    await pressPad(page, 7);
    const nextDraft = (await state()).draft;
    await slider.dispatchEvent('pointerup', { pointerId: 1 });
    assert.equal((await state()).position, dragged);
    assert.equal((await state()).draft, nextDraft);
    assert.equal((await state()).seeking, 'true');
    await pressPad(page, 0);
    assert.equal((await state()).position, Number(nextDraft));
    checks.push(`${mode}: an old canceled pointer cannot consume a new controller preview or its A confirmation`);

    await slider.focus();
    await page.keyboard.press('Home');
    assert.equal((await state()).draft, '0');
    assert.equal((await state()).position, Number(nextDraft));
    await page.keyboard.press('Enter');
    assert.equal((await state()).position, 0);
    assert.equal((await state()).paused, false);
    checks.push(`${mode}: fresh native Home editing after pointer cancellation still requires Enter and preserves playback`);

    await page.getByRole('button', { name: '暂停', exact: true }).focus();
    await pressPad(page, 7);
    await page.getByRole('button', { name: '播放速度', exact: true }).click();
    await page.getByRole('dialog', { name: '播放速度', exact: true }).waitFor();
    assert.equal((await state()).seeking, 'false');
    assert.equal((await state()).position, 0);
    await page.keyboard.press('Escape');
    assert.equal((await state()).position, 0);
    checks.push(`${mode}: opening and canceling a parameter menu discards the preview without seeking or pausing`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
