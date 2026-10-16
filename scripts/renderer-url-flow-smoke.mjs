import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-url-flow');
await mkdir(output, { recursive: true });
const checks = [];
for (const tv of [false, true]) {
  const mode = tv ? 'TV' : 'desktop';
  const { page, errors, close } = await launchHeadlessRenderer(tv
    ? { width: 1920, height: 1080 } : { width: 1440, height: 950 }, installReliabilityFixture);
  try {
    await page.evaluate(tv => {
      const state = window.reliability;
      state.boot.preferences.tvMode = tv;
      state.urls = [];
      state.failUrl = false;
      state.urlCancellations = 0;
      window.hub.openUrl = async url => {
        state.urls.push(url);
        if (state.failUrlIdentity) throw new Error('地址无法解析，请检查链接');
        return { id: `url:${url}`, source: 'url', kind: 'video', title: '网页视频', url };
      };
      window.hub.cancelUrlResolution = async () => { state.urlCancellations++; };
      const originalResolve = window.hub.resolve;
      window.hub.resolve = async (...args) => {
        const result = await originalResolve(...args);
        if (state.failUrl) throw new Error('网页检测失败，请重试');
        return result;
      };
    }, tv);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '打开链接', exact: true });
    const input = dialog.getByRole('textbox', { name: '视频地址', exact: true });
    const submit = () => dialog.locator('button.primary');
    await input.fill('https://small.example/watch');
    await connectPad(page);
    await submit().focus();
    await page.evaluate(() => { window.reliability.holdResolve = true; });
    await pressPad(page, 0);
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    const observation = await submit().evaluate(button => ({ disabled: button.disabled,
      focused: button === document.activeElement, focus: document.activeElement?.getAttribute('aria-label'),
      readonly: document.querySelector('.url-form input').readOnly }));
    await writeFile(resolve(output, `${mode}-pending.json`), JSON.stringify(observation));
    assert.equal(observation.focused, true);
    assert.equal(observation.disabled, false);
    assert.equal(observation.readonly, true);
    await pressPad(page, 0);
    await page.keyboard.press('Enter');
    const beforeMouse = await submit().evaluate(button => ({ focused: button === document.activeElement }));
    await submit().click({ force: true });
    const afterMouse = await submit().evaluate(button => { window.urlButton = button; return { focused: button === document.activeElement }; });
    assert.equal(await page.evaluate(() => window.reliability.urls.length), 1);
    checks.push(`${mode}: pending URL retains focus and submitted address, blocks repeated controller/Enter/mouse confirmation`);
    await page.evaluate(() => { window.reliability.failUrl = true; window.reliability.finishResolve(); });
    const error = dialog.getByText('网页检测失败，请重试', { exact: true });
    await error.waitFor();
    await page.screenshot({ path: resolve(output, `${mode}-failure.png`) });
    const afterFailure = await page.evaluate(() => ({
      focus: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'),
      mode: document.documentElement.dataset.inputMode, sameButton: window.urlButton === document.querySelector('.url-form button'),
    }));
    await writeFile(resolve(output, `${mode}-failure.json`), JSON.stringify({ beforeMouse, afterMouse, afterFailure }));
    assert.equal(await submit().evaluate(button => button === document.activeElement), true);
    assert.equal(await input.inputValue(), 'https://small.example/watch');
    await page.waitForTimeout(4600);
    assert.equal(await error.isVisible(), true);
    assert.equal(await page.locator('.toast').count(), 0);
    checks.push(`${mode}: failure remains inline beyond toast expiry, retains input and focused retry without duplicate feedback`);
    await page.evaluate(() => { window.reliability.finishResolve = undefined; });
    await pressPad(page, 0);
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    assert.equal(await error.isVisible(), true);
    await page.evaluate(() => { window.reliability.failUrl = false; window.reliability.holdResolve = false; window.reliability.finishResolve(); });
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    checks.push(`${mode}: retry keeps previous failure while pending, success dismisses original dialog and plays`);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));

    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    await input.fill('https://small.example/cancel');
    await page.evaluate(() => { window.reliability.holdResolve = true; window.reliability.finishResolve = undefined; });
    await submit().click();
    await page.waitForFunction(() => !!window.reliability.finishResolve);
    await pressPad(page, 1);
    await dialog.waitFor({ state: 'detached' });
    await page.evaluate(() => { window.reliability.holdResolve = false; window.reliability.finishResolve(); });
    await page.waitForFunction(() => window.reliability.releases.includes(window.reliability.resolves.at(-1).sessionId));
    assert.equal(await page.locator('.player').count(), 0);
    assert.ok(await page.evaluate(() => window.reliability.urlCancellations > 0));
    checks.push(`${mode}: B cancels pending URL, releases late session and never starts playback`);

    await page.getByRole('button', { name: '打开链接', exact: true }).click();
    await input.fill('https://small.example/invalid');
    await submit().focus();
    const beforeIdentity = await page.evaluate(() => window.reliability.urls.length);
    await page.evaluate(() => {
      window.reliability.failUrlIdentity = true;
      const form = document.querySelector('.url-form');
      form.requestSubmit();
      form.requestSubmit();
    });
    const invalid = dialog.getByText('地址无法解析，请检查链接', { exact: true });
    await invalid.waitFor();
    assert.equal(await page.evaluate(() => window.reliability.urls.length), beforeIdentity + 1);
    assert.equal(await submit().evaluate(button => button === document.activeElement), true);
    await input.fill('');
    assert.equal(await invalid.count(), 0);
    assert.equal(await submit().isDisabled(), true);
    checks.push(`${mode}: same-frame duplicate submission reports identity failure once; editing clears obsolete feedback and blank input cannot submit`);

    await input.fill('https://small.example/ime');
    await page.evaluate(() => { window.reliability.failUrlIdentity = false; });
    const beforeIme = await page.evaluate(() => window.reliability.urls.length);
    await input.dispatchEvent('compositionstart');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.reliability.urls.length), beforeIme);
    await input.dispatchEvent('compositionend');
    await page.waitForTimeout(50);
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
    checks.push(`${mode}: IME confirmation cannot start playback; explicit Enter after composition submits the edited URL`);
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
    assert.deepEqual(errors, []);
  } finally { await close(); }
}
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors: [] }, null, 2));
console.log(JSON.stringify({ checks, errors: [] }, null, 2));
