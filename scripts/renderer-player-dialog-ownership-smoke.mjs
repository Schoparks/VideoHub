import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { choosePlayerQuality } from './player-test-actions.mjs';

const output = resolve('.tmp/renderer-player-dialog-ownership');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const play = async () => {
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
  };
  const exit = async () => {
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
  };
  const settings = () => page.getByRole('dialog', { name: '设置', exact: true });
  const theme = () => settings().getByRole('switch', { name: '深色外观', exact: true });
  const finishResolve = async () => {
    await page.evaluate(() => {
      window.reliability.holdResolve = false;
      window.reliability.finishResolve();
    });
    await page.waitForFunction(() => document.querySelector('.player')?.dataset.switching === 'false');
  };
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await play();
    await page.evaluate(() => { window.reliability.holdResolve = true; });
    await page.locator('[data-player-action="next"]').click();
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await theme().click();
    await theme().focus();
    await finishResolve();
    const observation = await page.evaluate(() => ({
      dialog: document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
      focus: document.activeElement?.getAttribute('aria-label'),
      theme: window.reliability.boot.preferences.theme,
      part: window.reliability.resolves.at(-1).part,
    }));
    await writeFile(resolve(output, `${mode}-settings.json`), JSON.stringify(observation));
    assert.equal(await settings().count(), 1);
    assert.equal(await theme().evaluate(node => node === document.activeElement), true);
    assert.equal(observation.theme, 'dark');
    assert.equal(observation.part, 'cid:2');
    checks.push(`${mode}: a pending episode result preserves newer settings, its focused control and saved preference`);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await exit();

    await page.evaluate(() => { window.reliability.omitParts = true; });
    await play();
    await page.evaluate(() => { window.reliability.holdDetail = true; window.reliability.holdResolve = true; });
    await page.locator('[data-player-action="next"]').click();
    await page.waitForFunction(() => !!window.reliability.finishDetail);
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await theme().focus();
    await page.evaluate(() => { window.reliability.holdDetail = false; window.reliability.finishDetail(); });
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    await finishResolve();
    assert.equal(await settings().count(), 1);
    assert.equal(await theme().evaluate(node => node === document.activeElement), true);
    checks.push(`${mode}: unknown episode discovery and resolution preserve settings opened during discovery`);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await exit();

    await page.evaluate(() => { window.reliability.omitParts = false; });
    await play();
    await page.evaluate(() => { window.reliability.holdResolve = true; });
    await choosePlayerQuality(page, 64);
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('button', { name: '播放设置', exact: true }).click();
    await theme().focus();
    await finishResolve();
    assert.equal(await settings().count(), 1);
    assert.equal(await theme().evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).quality), 64);
    checks.push(`${mode}: quality result preserves a subsequently reopened settings dialog and its focus`);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await exit();

    await play();
    const queue = () => page.getByRole('dialog', { name: '播放队列', exact: true });
    const queuedItem = () => queue().getByRole('button', { name: '播放 另一项', exact: true });
    await page.getByRole('button', { name: '播放队列', exact: true }).click();
    await page.evaluate(() => { window.reliability.holdResolve = true; });
    await queuedItem().click();
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    await finishResolve();
    await queue().waitFor({ state: 'detached' });
    checks.push(`${mode}: normal playback dismisses its original queue dialog`);

    await page.getByRole('button', { name: '播放队列', exact: true }).click();
    const previousSession = await page.evaluate(() => window.reliability.resolves.at(-1).sessionId);
    await page.evaluate(() => { window.reliability.holdResolve = true; });
    await queuedItem().click();
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('button', { name: '播放队列', exact: true }).click();
    await queuedItem().focus();
    await finishResolve();
    await page.waitForFunction(id => window.reliability.releases.includes(id), previousSession);
    assert.equal(await queue().count(), 1);
    assert.equal(await queuedItem().evaluate(node => node === document.activeElement), true);
    checks.push(`${mode}: a reopened dialog of the initiating kind belongs to a new generation`);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await exit();
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
