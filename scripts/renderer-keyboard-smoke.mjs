import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-keyboard');
await mkdir(output, { recursive: true });
const session = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const { page, errors } = session;
const checks = [];
const press = index => pressPad(page, index);
const type = async text => {
  for (const letter of text) await page.locator('.keyboard-keys').getByRole('button', { name: letter, exact: true }).click();
};
try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  let failedDictionary = false;
  await page.route('**/ime/pinyin.json', route => {
    if (!failedDictionary) { failedDictionary = true; return route.abort(); }
    return route.continue();
  });
  await connectPad(page);
  await press(3);
  const input = page.getByRole('textbox', { name: '搜索关键词', exact: true });
  await input.waitFor();
  await page.getByRole('button', { name: '词库加载失败 · 重试', exact: true }).waitFor();
  await type('xing');
  await page.getByRole('button', { name: '词库加载失败 · 重试', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.candidate-row button').length > 0);
  assert.equal(await page.locator('output[aria-label="待选拼音"]').innerText(), 'xing');
  await press(6);
  checks.push('dictionary failure is visible and retry preserves uncommitted text using the bundled resource');
  await type('xingfu');
  await page.locator('.candidate-row').getByRole('button', { name: '幸福', exact: true }).waitFor();
  assert.equal(await input.inputValue(), '');
  await press(3);
  assert.equal(await input.inputValue(), '幸福');
  assert.equal(await page.getByRole('dialog').count(), 1);
  await type('zhongdianzhan');
  await page.locator('.candidate-row').getByRole('button', { name: '终点', exact: true }).click();
  assert.equal(await page.locator('output[aria-label="待选拼音"]').innerText(), 'zhan');
  await page.locator('.candidate-row').getByRole('button', { name: '站', exact: true }).click();
  assert.equal(await input.inputValue(), '幸福终点站');
  await page.screenshot({ path: resolve(output, 'chinese-desktop.png') });
  await press(3);
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal(await page.getByRole('heading', { name: '搜索：幸福终点站', exact: true }).count(), 1);
  checks.push('offline pinyin phrases retain suffixes, Y confirms candidates before submitting the exact final keyword');

  await press(3);
  await input.waitFor();
  await press(4);
  assert.equal(await page.getByRole('button', { name: '切换中英文' }).innerText(), 'English');
  await input.fill('abc');
  await input.evaluate(input => input.setSelectionRange(1, 2));
  await type('z');
  assert.equal(await input.inputValue(), 'azc');
  await press(2);
  assert.equal(await input.inputValue(), 'ac');
  await press(6);
  assert.equal(await input.inputValue(), '');
  await page.getByRole('button', { name: '大写', exact: true }).click();
  await type('TV');
  await press(5);
  await type('2');
  assert.equal(await input.inputValue(), 'TV2');
  checks.push('LB switches English, insertion replaces selections, X deletes, LT clears, uppercase and RB numbers preserve text');
  await press(3);
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal(await page.getByRole('heading', { name: '搜索：TV2', exact: true }).count(), 1);

  await press(3);
  await input.fill('取消的草稿');
  await press(1);
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal(await page.getByRole('textbox', { name: '搜索视频', exact: true }).inputValue(), 'TV2');
  await press(3);
  assert.equal(await input.inputValue(), 'TV2');
  await input.fill('');
  await type('shi');
  const first = await page.locator('.candidate-row').allTextContents();
  await page.getByRole('button', { name: '下一页候选', exact: true }).click();
  assert.notDeepEqual(await page.locator('.candidate-row').allTextContents(), first);
  await press(1);
  assert.equal(await page.getByRole('dialog').count(), 1);
  assert.equal(await page.locator('output[aria-label="待选拼音"]').innerText(), '拼音');
  await press(1);
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  checks.push('cancel preserves the original search; candidate paging works and B cancels pinyin before closing');

  const global = page.getByRole('textbox', { name: '搜索视频', exact: true });
  await global.fill('中文输入');
  await global.evaluate(input => {
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    input.form.requestSubmit();
  });
  assert.equal(await page.getByRole('heading', { name: '搜索：TV2', exact: true }).count(), 1);
  await global.evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await page.waitForTimeout(50);
  await global.press('Enter');
  assert.equal(await page.getByRole('heading', { name: '搜索：中文输入', exact: true }).count(), 1);
  checks.push('native Chinese IME confirmation cannot accidentally submit; the next Enter submits normally');

  await page.getByRole('button', { name: '打开链接', exact: true }).click();
  await page.getByRole('textbox', { name: '视频地址', exact: true }).focus();
  await press(0);
  const edit = page.getByRole('textbox', { name: '输入内容', exact: true });
  await edit.waitFor();
  await type('abc');
  await press(1);
  assert.equal(await page.getByRole('textbox', { name: '视频地址', exact: true }).inputValue(), '');
  await press(0);
  await type('xyz');
  await press(3);
  assert.equal(await page.getByRole('textbox', { name: '视频地址', exact: true }).inputValue(), 'xyz');
  await press(1);
  checks.push('nested URL editing defaults to English and preserves cancel/commit semantics with shortcut confirmation');

  await page.getByRole('button', { name: '切换电视模式', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await press(3);
  await input.fill('');
  await type('shi');
  await page.waitForFunction(() => document.querySelectorAll('.candidate-row button').length === 5);
  await press(15);
  const layout = await page.getByRole('dialog').evaluate(dialog => {
    const buttons = [...dialog.querySelectorAll('button')];
    return buttons.every(button => {
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight && (hit === button || button.contains(hit));
    });
  });
  assert.equal(layout, true);
  await page.screenshot({ path: resolve(output, 'chinese-tv.png') });
  checks.push('TV keyboard and candidate controls are in bounds and individually reachable');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors, output }, null, 2));
} finally { await session.close(); }
