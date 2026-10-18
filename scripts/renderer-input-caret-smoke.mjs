import { openSearchKeyboard } from './search-test-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

const output = resolve('.tmp/renderer-input-caret');
await mkdir(output, { recursive: true });
const { page, errors, close } = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const checks = [];

try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await openSearchKeyboard(page);
  await page.getByRole('button', { name: '切换中英文', exact: true }).click();
  const input = page.getByRole('textbox', { name: '搜索关键词', exact: true });
  await input.fill('abc');
  const result = await page.evaluate(async () => {
    const input = document.querySelector('.search-dialog input');
    input.setSelectionRange(1, 2);
    const original = window.requestAnimationFrame;
    const frames = [];
    window.requestAnimationFrame = callback => { frames.push(callback); return -frames.length; };
    try {
      [...document.querySelectorAll('.keyboard-keys button')].find(button => button.textContent === 'z').click();
      await new Promise(resolve => setTimeout(resolve, 30));
      return { value: input.value, caret: input.selectionStart };
    } finally {
      window.requestAnimationFrame = original;
      for (const callback of frames) original(callback);
    }
  });
  assert.deepEqual(result, { value: 'azc', caret: 2 });
  await page.getByRole('button', { name: '退格', exact: true }).click();
  assert.equal(await input.inputValue(), 'ac');
  checks.push('selection replacement commits its caret before delayed animation frames; immediate backspace deletes the inserted character');

  await input.fill('a👨‍👩‍👧‍👦c');
  await input.evaluate(input => input.setSelectionRange(input.value.length - 1, input.value.length - 1));
  await page.getByRole('button', { name: '退格', exact: true }).click();
  assert.equal(await input.inputValue(), 'ac');
  assert.equal(await input.evaluate(input => input.selectionStart), 1);
  await page.locator('.keyboard-keys').getByRole('button', { name: 'b', exact: true }).click();
  assert.equal(await input.inputValue(), 'abc');
  assert.equal(await input.evaluate(input => input.selectionStart), 2);
  checks.push('grapheme deletion and subsequent insertion retain the logical caret within a longer value');

  await input.fill('abcd');
  await input.evaluate(input => input.setSelectionRange(1, 3));
  await page.getByRole('button', { name: '退格', exact: true }).click();
  assert.equal(await input.inputValue(), 'ad');
  assert.equal(await input.evaluate(input => input.selectionStart), 1);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await openSearchKeyboard(page);
  assert.equal(await input.inputValue(), '');
  checks.push('selection deletion restores the caret at its start; canceled drafts do not change the original search');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await close(); }
