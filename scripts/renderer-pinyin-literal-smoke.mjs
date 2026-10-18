import { openSearchKeyboard } from './search-test-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-pinyin-literal');
await mkdir(output, { recursive: true });
const checks = [];
const cases = ['start', 'y', 'enter', 'space'];
const selected = process.argv[2] ? cases.filter(name => name === process.argv[2]) : cases;
assert.ok(selected.length, 'unknown confirmation case');
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  const input = page.getByRole('textbox', { name: '搜索关键词', exact: true });
  const type = async text => {
    for (const letter of text) await page.locator('.keyboard-keys').getByRole('button', { name: letter, exact: true }).click();
  };
  const open = async () => {
    await openSearchKeyboard(page);
    await input.fill('');
  };
  const confirm = async name => {
    if (name === 'start' || name === 'y') await pressPad(page, name === 'start' ? 9 : 3);
    else if (name === 'enter') await input.press('Enter');
    else {
      await page.locator('.keyboard-bottom').getByRole('button', { name: '空格', exact: true }).focus();
      await page.keyboard.press('Space');
    }
  };
  let releaseDictionary;
  try {
    await page.evaluate(tv => { window.reliability.boot.preferences.tvMode = tv; }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await connectPad(page);
    const dictionaryGate = new Promise(resolve => { releaseDictionary = resolve; });
    let dictionaryRequests = 0;
    await page.route('**/ime/pinyin.json', async route => {
      if (++dictionaryRequests === 1) return route.abort();
      await dictionaryGate;
      await route.continue();
    });
    await open();
    await type('qqq');
    const retry = page.getByRole('button', { name: '词库加载失败 · 重试', exact: true });
    await retry.waitFor();
    await confirm('start');
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await input.inputValue(), '');
    assert.equal(await page.locator('output[aria-label="待选拼音"]').innerText(), 'qqq');
    assert.equal(await page.locator('.pinyin-candidates').getByText('无候选词', { exact: true }).count(), 0);
    await retry.click();
    checks.push(`${mode}: dictionary failure is distinct from no candidates and preserves the draft for retry`);
    await page.getByRole('status').filter({ hasText: '正在加载词库' }).waitFor();
    await confirm('start');
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await input.inputValue(), '');
    assert.equal(await page.locator('output[aria-label="待选拼音"]').innerText(), 'qqq');
    releaseDictionary();
    await page.locator('.pinyin-candidates').getByText('无候选词', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await pressPad(page, 1);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    checks.push(`${mode}: pending dictionary input remains uncommitted and cannot search before readiness`);
    for (const name of selected) {
      await open();
      await type('qqq');
      await page.locator('.pinyin-candidates').getByText('无候选词', { exact: true }).waitFor();
      assert.equal(await page.locator('.search-dialog form').getByRole('button', { name: '确认输入', exact: true }).count(), 1);
      assert.equal(await input.inputValue(), '');
      const before = await page.evaluate(() => window.reliability.browse.filter(request => request.kind === 'search').length);
      await confirm(name);
      const state = await page.evaluate(() => ({
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        text: document.querySelector('.search-dialog input')?.value,
        composing: document.querySelector('[data-screen-keyboard]')?.dataset.composing,
        searched: document.querySelector('input[aria-label="搜索视频"]')?.value,
      }));
      await writeFile(resolve(output, `${mode}-${name}.json`), JSON.stringify(state, null, 2));
      assert.equal(state.dialogs, 1, `${name}: literal confirmation must keep editing open`);
      assert.equal(state.text, 'qqq', `${name}: the unknown spelling must be committed exactly once`);
      assert.equal(state.composing, 'false');
      assert.equal(await page.evaluate(() => window.reliability.browse.filter(request => request.kind === 'search').length), before);
      assert.equal(await page.locator('[data-screen-keyboard]').getAttribute('data-submit-label'), '搜索');
      if (name === 'space') {
        await page.locator('.keyboard-bottom').getByRole('button', { name: '空格', exact: true }).focus();
        await page.keyboard.press('Space');
        assert.equal(await input.inputValue(), 'qqq ');
      }
      await confirm('start');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('heading', { name: '搜索：qqq', exact: true }).count(), 1);
      checks.push(`${mode}/${name}: unknown spelling confirms locally first, then submits the exact keyword without a premature search`);
    }

    await open();
    await type('shiqqq');
    await page.locator('.candidate-row').getByRole('button', { name: '是', exact: true }).waitFor();
    await confirm('start');
    assert.equal(await input.inputValue(), '是');
    assert.equal(await page.locator('output[aria-label="待选拼音"]').innerText(), 'qqq');
    await confirm('y');
    assert.equal(await input.inputValue(), '是qqq');
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.screenshot({ path: resolve(output, `${mode}.png`) });
    await confirm('start');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('heading', { name: '搜索：是qqq', exact: true }).count(), 1);
    checks.push(`${mode}: a valid candidate followed by an unknown suffix retains both parts and needs an explicit final submission`);

    await open();
    await type('qqq');
    await confirm('start');
    await pressPad(page, 1);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('textbox', { name: '搜索视频', exact: true }).inputValue(), '是qqq');
    checks.push(`${mode}: canceling a confirmed literal draft preserves the previous search`);

    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    await page.getByRole('textbox', { name: '视频地址', exact: true }).focus();
    await pressPad(page, 0);
    const entry = page.getByRole('textbox', { name: '输入内容', exact: true });
    await entry.waitFor();
    await pressPad(page, 4);
    await type('qqq');
    await page.locator('.pinyin-candidates').getByText('无候选词', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '确认输入', exact: true }).count(), 1);
    await confirm('start');
    assert.equal(await page.getByRole('dialog').count(), 2);
    assert.equal(await entry.inputValue(), 'qqq');
    assert.equal(await page.getByRole('button', { name: '完成', exact: true }).count(), 1);
    await confirm('start');
    await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 1);
    assert.equal(await page.getByRole('textbox', { name: '视频地址', exact: true }).inputValue(), 'qqq');
    await pressPad(page, 1);
    checks.push(`${mode}: nested text editing confirms literal input before its separate completion and uses matching button labels`);
    assert.deepEqual(errors, []);
  } finally { releaseDictionary?.(); await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, offlineDictionary: true, simulatedPad: true }, null, 2));
console.log(JSON.stringify({ checks }, null, 2));
