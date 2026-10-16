import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-player-hit-stability');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const timeline = page.getByRole('slider', { name: '播放进度', exact: true });
  const snapshot = () => page.locator('.player').evaluate(player => {
    const box = selector => {
      const rect = player.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const hint = player.querySelector('.player-hints .controller-focus-hint:not([hidden])');
    const host = player.querySelector('.player-hints [data-input-hints-host]').getBoundingClientRect();
    const rect = hint?.getBoundingClientRect();
    const status = player.querySelector('.player-hints small').getBoundingClientRect();
    const separated = !rect || rect.right <= status.left || rect.left >= status.right
      || rect.bottom <= status.top || rect.top >= status.bottom;
    const hintFits = !rect || rect.right <= host.right + .5 && rect.bottom <= host.bottom + .5
      && separated;
    return { timeline: box('.timeline'), buttons: box('.player-buttons'), hints: box('.player-hints'),
      hintFits, mode: document.documentElement.dataset.inputMode };
  });
  const sameTargets = (before, after) => {
    assert.ok(after.hintFits, `${mode}: action hints must fit their slot without overlapping status`);
    for (const key of ['timeline', 'buttons']) {
      for (const dimension of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(before[key][dimension] - after[key][dimension]) < .5,
          `${mode}: ${key} ${dimension} moved from ${before[key][dimension]} to ${after[key][dimension]}`);
      }
    }
  };
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await connectPad(page);
    await page.getByRole('button', { name: '暂停', exact: true }).evaluate(button => button.click());
    await page.waitForFunction(() => document.querySelector('video')?.paused);
    await page.locator('video').evaluate(video => { video.currentTime = 40; });
    await timeline.focus();
    const before = await snapshot();
    await page.screenshot({ path: resolve(output, `${mode}-gamepad.png`) });
    const x = before.timeline.x + before.timeline.width * .75;
    const y = before.timeline.y + before.timeline.height / 2;
    await page.mouse.move(x, y);
    await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'pointer');
    const after = await snapshot();
    await page.mouse.down();
    await page.mouse.up();
    const actual = await page.locator('video').evaluate(video => ({ position: video.currentTime, paused: video.paused }));
    await writeFile(resolve(output, `${mode}-pointer.json`), JSON.stringify({ before, after, actual }, null, 2));
    sameTargets(before, after);
    assert.ok(Math.abs(actual.position - 90) < 2, 'the first click must seek the intended point');
    assert.equal(actual.paused, true, 'clicking the timeline must not toggle video playback');
    assert.equal(await page.locator('.player-hints .controller-focus-hint').getAttribute('hidden'), '');
    await page.screenshot({ path: resolve(output, `${mode}-pointer.png`) });
    checks.push(`${mode}: switching from gamepad to pointer keeps targets fixed and the first timeline click seeks correctly`);

    await pressPad(page, 12);
    sameTargets(before, await snapshot());
    await timeline.focus();
    await pressPad(page, 14);
    sameTargets(before, await snapshot());
    await pressPad(page, 1);
    sameTargets(before, await snapshot());
    checks.push(`${mode}: gamepad activation, short seek guidance and canceled preview keep controls in place`);

    await timeline.focus();
    await page.keyboard.press('ArrowLeft');
    sameTargets(before, await snapshot());
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '播放速度', exact: true }).focus();
    sameTargets(before, await snapshot());
    await page.screenshot({ path: resolve(output, `${mode}-keyboard.png`) });
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: '播放速度', exact: true }).waitFor();
    sameTargets(before, await snapshot());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '播放速度');
    sameTargets(before, await snapshot());
    checks.push(`${mode}: keyboard guidance and moving hints into and out of a parameter menu do not shift targets`);

    await pressPad(page, 12);
    await page.getByRole('button', { name: '清晰度', exact: true }).focus();
    const target = await page.getByRole('button', { name: '清晰度', exact: true }).boundingBox();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.getByRole('dialog', { name: '清晰度', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    checks.push(`${mode}: first pointer click on a controller-focused quality button opens the intended menu without toggling video`);

    await page.evaluate(() => {
      window.testPad.id += ' generic';
      window.testPad.mapping = '';
    });
    await page.waitForFunction(() => document.querySelector('.player-hints .controller-actions')?.textContent.includes('按键 9'));
    sameTargets(before, await snapshot());
    checks.push(`${mode}: longer generic controller key labels remain complete inside the reserved hint slot`);

    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    await page.mouse.move(500, 400);
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    const fresh = await snapshot();
    await pressPad(page, 12);
    sameTargets(fresh, await snapshot());
    checks.push(`${mode}: pointer-first playback reserves the same targets before any controller hint exists`);

    await page.evaluate(() => { window.reliability.holdResolve = true; });
    await pressPad(page, 5);
    await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'true');
    sameTargets(fresh, await snapshot());
    checks.push(`${mode}: pending source changes can shorten guidance without moving the retained controls`);
    await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
    await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false');

    await page.locator('video').evaluate(video => video.dispatchEvent(new Event('error')));
    await page.getByRole('button', { name: '重试', exact: true }).waitFor();
    assert.equal(await page.locator('.player-overlay .controller-focus-hint:not([hidden])').count(), 0);
    await page.waitForFunction(() => !!document.querySelector('.player-error .controller-actions'));
    checks.push(`${mode}: failure guidance belongs only to the visible error scope`);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(output, `${mode}-error.png`) });
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
