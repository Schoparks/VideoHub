import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('.tmp/controller-smoke', { recursive: true });
const profile = await mkdtemp(resolve('.tmp/controller-smoke/profile-'));
const server = await createServer({ server: { port: 5173, strictPort: true } });
await server.listen();
const env = { ...process.env, YINGJI_TEST_DATA: profile, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0] };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.', '--disable-gpu', '--in-process-gpu'], cwd: resolve('.'), env, timeout: 30000 });
app.process().stderr.on('data', data => process.stderr.write(data));
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '首页' }).waitFor();
  await page.getByRole('button', { name: '打开链接', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '视频地址');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '打开链接');
  await page.reload();
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  await page.waitForFunction(() => document.hasFocus());
  await page.evaluate(() => {
    document.activeElement.blur();
    window.testPad = { id: 'Simulated Xbox focus regression', index: 0, connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
  });
  await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'gamepad' && document.activeElement?.classList.contains('nav-item'));
  assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth) > 0));
  assert.match(await page.locator('.controller-focus-hint').innerText(), /逐级切栏/);
  await page.screenshot({ path: '.tmp/controller-smoke/gamepad-focus.png' });
  const press = async (index) => {
    await page.evaluate(async button => {
      window.testPad.buttons[button].pressed = true;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.testPad.buttons[button].pressed = false;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, index);
  };
  await press(15);
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '哔哩哔哩');
  await press(0);
  assert.equal(await page.getByRole('heading', { name: '哔哩哔哩', exact: true }).count(), 1);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-input-mode'), 'pointer');
  await press(13);
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true);
  await press(1);
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '设置');
  assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth) > 0));
  await page.evaluate(() => {
    const panel = document.createElement('div');
    panel.dataset.focusScope = '';
    panel.id = 'focus-fixture';
    panel.style.cssText = 'position:fixed;left:300px;top:200px;z-index:100;padding:40px;background:white';
    panel.innerHTML = '<button id="fixture-first">开始</button><select aria-label="清晰度测试"><option value="a">480P</option><option value="b" disabled>禁用</option><option value="c">1080P</option></select><button id="fixture-hidden" style="visibility:hidden">不可见</button><button id="fixture-last">结束</button><footer data-input-hints-host></footer>';
    document.body.append(panel);
    panel.querySelector('select').focus();
  });
  await press(15);
  assert.equal(await page.getByRole('combobox', { name: '清晰度测试' }).inputValue(), 'c');
  await press(0);
  assert.equal(await page.getByRole('combobox', { name: '清晰度测试' }).inputValue(), 'a');
  assert.match(await page.locator('.controller-focus-hint').innerText(), /清晰度测试 · 480P/);
  await press(13);
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('#focus-fixture')), true);
  const visible = await page.evaluate(async () => {
    const { focusables } = await import('/src/input/gamepad.ts');
    return focusables(document.querySelector('#focus-fixture')).map(element => element.id);
  });
  assert.deepEqual(visible, ['fixture-first', '', 'fixture-last']);
  await page.evaluate(() => document.querySelector('#focus-fixture').remove());
  await press(15);
  assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
  await page.mouse.move(1, 1);
  await page.waitForFunction(() => document.documentElement.dataset.inputMode === 'pointer');
  assert.equal(await page.locator('.controller-focus-hint').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', checks: ['dialog autofocus and opener restoration', 'gamepad connection establishes visible focus', 'directional navigation', 'gamepad modal confinement and return', 'select value changes skip disabled options and A cycles', 'focus scope excludes invisible elements', 'focus recovery after removal', 'pointer switches off gamepad indicator'], errors }, null, 2));
} finally {
  await app.close();
  await server.close();
}
