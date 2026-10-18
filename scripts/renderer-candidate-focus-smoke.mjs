import { openSearchKeyboard } from './search-test-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-candidate-focus');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const freeze = () => page.evaluate(() => {
    const audit = window.candidateAudit = {
      frame: requestAnimationFrame, cancel: cancelAnimationFrame, callbacks: new Map(), id: 0,
    };
    window.requestAnimationFrame = callback => {
      const id = --audit.id;
      audit.callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = id => {
      if (id < 0) audit.callbacks.delete(id);
      else audit.cancel(id);
    };
  });
  const release = async () => {
    await page.evaluate(() => {
      const audit = window.candidateAudit;
      window.requestAnimationFrame = audit.frame;
      for (const [id, callback] of audit.callbacks) requestAnimationFrame(time => {
        if (!audit.callbacks.has(id)) return;
        audit.callbacks.delete(id);
        callback(time);
      });
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => { window.cancelAnimationFrame = window.candidateAudit.cancel; });
  };
  const active = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')
    || document.activeElement?.textContent);
  const type = async text => {
    for (const letter of text) await page.locator('.keyboard-keys').getByRole('button', { name: letter, exact: true }).click();
  };
  const input = page.getByRole('textbox', { name: '搜索关键词', exact: true });
  const prepare = async () => {
    const clear = page.getByRole('button', { name: '清空', exact: true });
    if (await clear.getAttribute('aria-disabled') !== 'true') await clear.click();
    await type('zhongdianzhan');
    await page.locator('.candidate-row').getByRole('button', { name: '终点', exact: true }).waitFor();
  };
  const choose = () => page.locator('.candidate-row').getByRole('button', { name: '终点', exact: true }).click();
  const verifyText = async () => {
    assert.equal(await input.inputValue(), '终点');
    assert.equal(await page.locator('output[aria-label="待选拼音"]').innerText(), 'zhan');
  };
  try {
    await page.getByRole('button', { name: '重试', exact: true }).click();
    if (tv) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('switch', { name: '电视模式', exact: true }).click();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    }
    await openSearchKeyboard(page);
    await prepare();
    await choose();
    await page.waitForFunction(() => document.activeElement?.textContent === 'n');
    await verifyText();
    checks.push(`${mode}: normal partial candidate confirmation restores the last letter key and retains its suffix`);

    await prepare();
    await freeze();
    await choose();
    await verifyText();
    await page.keyboard.press('Tab');
    const tabFocus = await active();
    assert.equal(tabFocus, '关闭弹窗');
    await release();
    const afterTab = await active();
    await writeFile(resolve(output, `${mode}-tab.json`), JSON.stringify({ before: tabFocus, after: afterTab }, null, 2));
    assert.equal(afterTab, tabFocus, 'candidate return must not override newer Tab navigation');
    checks.push(`${mode}: a delayed candidate return respects newer native Tab navigation`);

    await prepare();
    await freeze();
    await choose();
    await page.getByRole('button', { name: '下一页候选', exact: true }).click();
    const pointerFocus = await active();
    assert.equal(pointerFocus, '下一页候选');
    await release();
    assert.equal(await active(), pointerFocus);
    await verifyText();
    checks.push(`${mode}: paging the remaining candidates with a pointer keeps the new entry focused`);

    await connectPad(page);
    await prepare();
    await pressPad(page, 9);
    await prepare();
    await freeze();
    await choose();
    await page.evaluate(() => { window.testPad.buttons[15] = { pressed: true, value: 1 }; });
    await release();
    await page.evaluate(() => { window.testPad.buttons[15] = { pressed: false, value: 0 }; });
    assert.notEqual(await active(), 'n', 'a later simulated-pad direction must supersede candidate focus');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]:not([inert])')), true);
    await verifyText();
    await page.screenshot({ path: resolve(output, `${mode}.png`) });
    checks.push(`${mode}: a later actual simulated-pad direction keeps focus within the keyboard without returning to the letter key`);

    await pressPad(page, 9);
    assert.equal(await input.inputValue(), '终点站');
    assert.equal(await page.getByRole('dialog').count(), 1);
    await pressPad(page, 9);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('heading', { name: '搜索：终点站', exact: true }).count(), 1);
    checks.push(`${mode}: Start confirms the remaining word before submitting and preserves the exact search`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, delayedFrames: true, simulatedPad: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
