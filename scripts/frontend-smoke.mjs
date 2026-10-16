import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { frontendFixture, installFrontendFixture, installFrontendImages } from './frontend-fixture.mjs';
import { assertFrontendLayout } from './frontend-layout.mjs';

const output = resolve('.tmp/frontend-smoke');
await mkdir(output, { recursive: true });
await readFile('dist/index.html');
await readFile('dist-electron/main.cjs');
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, YINGJI_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({
  args: ['.', '--disable-gpu', '--in-process-gpu'],
  cwd: resolve('.'),
  env,
  timeout: 30000,
});
let page;
const errors = [];
const checks = [];
const layouts = {};
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  const boot = await page.evaluate(() => window.hub.bootstrap());
  await app.evaluate(installFrontendFixture, frontendFixture(boot));
  await installFrontendImages(page);
  const capture = async name => {
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    layouts[name] = await assertFrontendLayout(page, name);
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
  };
  const home = () => page.getByRole('button', { name: '首页', exact: true }).click();
  const close = async () => {
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  };
  const settings = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  };
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 12);
  await page.waitForFunction(() => [...document.querySelectorAll('.cover img')].slice(0, 4)
    .every(image => image.complete && image.naturalWidth > 0));
  await capture('home-1440');
  assert.equal(await page.locator('.welcome-banner').count(), 0);
  checks.push('home prioritizes actual content and contains long titles, author names and counts');

  for (const width of [1440, 980]) {
    await page.setViewportSize({ width, height: width === 980 ? 680 : 950 });
    await page.getByRole('button', { name: '我的收藏', exact: true }).click();
    await page.getByRole('button', { name: /^播放队列/ }).click();
    await page.locator('.queue-row').first().waitFor();
    await capture(`queue-${width}`);
    await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
    await page.getByRole('button', { name: '关注动态', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.dynamic-entry').length === 2);
    await capture(`dynamic-${width}`);
    await page.getByRole('button', { name: '视频', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.dynamic-entry').length === 1);
    await page.getByRole('button', { name: '全部', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.dynamic-entry').length === 2);
    await home();
    await capture(`home-${width}`);
  }
  const activeNavigation = await page.locator('.navigation-bar nav').evaluate(nav => {
    const home = nav.querySelector('[aria-current="page"]');
    const inactive = [...nav.querySelectorAll('button')].find(button => button !== home);
    return {
      name: home?.getAttribute('aria-label'),
      background: home && getComputedStyle(home).backgroundColor,
      inactiveBackground: inactive && getComputedStyle(inactive).backgroundColor,
    };
  });
  assert.equal(activeNavigation.name, '首页');
  assert.notEqual(activeNavigation.background, activeNavigation.inactiveBackground);
  checks.push('1440px and 980px content, long dynamic text, queue and navigation have no horizontal overflow');

  await page.getByRole('button', { name: '打开链接', exact: true }).click();
  await page.getByRole('dialog', { name: '打开链接', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '视频地址' }).fill('https://example.com/' + 'a'.repeat(400));
  await capture('link-980');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '打开链接');
  await page.keyboard.press('y');
  await page.getByRole('dialog', { name: '搜索', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索关键词' }).fill('长搜索关键词'.repeat(40));
  await capture('search-980');
  await close();
  checks.push('search and link dialogs contain long input and close with button or Escape; opener focus returns');

  await settings();
  const dark = page.getByRole('switch', { name: '深色外观', exact: true });
  await dark.click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await dark.isChecked(), true);
  await capture('settings-dark-980');
  const thumbOffset = await dark.evaluate(input =>
    new DOMMatrix(getComputedStyle(input, '::before').transform).m41);
  assert.ok(thumbOffset > 0, 'checked switch thumb must reach its enabled position');
  await page.getByRole('dialog', { name: '设置', exact: true }).evaluate(dialog => {
    dialog.scrollTop = dialog.scrollHeight;
  });
  const closeBounds = await page.getByRole('button', { name: '关闭弹窗', exact: true }).boundingBox();
  assert.ok(closeBounds && closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= 680,
    'settings close button must remain visible after scrolling to the bottom');
  await capture('settings-bottom-980');
  const closeReceivesPointer = await page.getByRole('button', { name: '关闭弹窗', exact: true })
    .evaluate(button => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
  assert.equal(closeReceivesPointer, true, 'sticky close button must not be obscured');
  await close();
  await capture('home-dark-980');
  await settings();
  const tv = page.getByRole('switch', { name: '电视模式', exact: true });
  await tv.click();
  await page.waitForFunction(() => document.documentElement.dataset.tv === 'true');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await capture('settings-tv-1920');
  await close();
  await capture('home-tv-1920');
  const saved = await app.evaluate(() => ({
    preferences: globalThis.frontendSmoke.preferences,
    fullscreen: globalThis.frontendSmoke.fullscreen,
  }));
  assert.equal(saved.preferences.at(-1).theme, 'dark');
  assert.equal(saved.preferences.at(-1).tvMode, true);
  assert.deepEqual(saved.fullscreen, [true]);
  checks.push('settings switches apply immediately; sticky close remains visible after scroll; dark and TV layouts fit');

  await settings();
  await page.getByRole('switch', { name: '电视模式', exact: true }).click();
  await page.getByRole('switch', { name: '深色外观', exact: true }).click();
  await close();
  await page.setViewportSize({ width: 980, height: 680 });
  for (const mode of ['empty', 'error', 'loading']) {
    await app.evaluate((_electron, value) => { globalThis.frontendSmoke.mode = value; }, mode);
    await page.reload();
    await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
    if (mode === 'error') await page.getByRole('alert').waitFor();
    else if (mode === 'loading') await page.locator('main [role="status"]').waitFor();
    else await page.locator('.empty-state').first().waitFor();
    await capture(`state-${mode}-980`);
    if (mode === 'error') {
      await app.evaluate(() => { globalThis.frontendSmoke.mode = 'normal'; });
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 12);
      assert.equal(await page.getByRole('alert').count(), 0);
    }
    if (mode === 'loading') {
      await app.evaluate(() => {
        globalThis.frontendSmoke.mode = 'normal';
        globalThis.frontendSmoke.finishLoading();
      });
      await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 12);
    }
  }
  checks.push('empty, error and loading states fit the narrow viewport; retry and load completion restore content');
  assert.deepEqual(errors, []);
  const result = { result: 'passed', profile, checks, layouts, errors };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ result: result.result, checks, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(output, 'failure.png'), timeout: 3000 }).catch(() => {});
  }
  throw error;
} finally {
  await app.close();
}
