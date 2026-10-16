import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { installLibraryFixture } from './renderer-library-fixture.mjs';
import { assertFrontendLayout } from './frontend-layout.mjs';

const output = resolve('.tmp/renderer-library');
await mkdir(output, { recursive: true });
const session = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const { page, errors } = session;
const checks = [];
const configure = value => page.evaluate(value => Object.assign(window.libraryTest, value), value);
const count = () => page.evaluate(() => window.libraryTest.requests.length);
const local = page.locator('[data-local-library]');
const openFile = page.getByRole('button', { name: '打开文件', exact: true });
const finish = () => page.evaluate(() => { window.libraryTest.hold = false; window.libraryTest.finish(); });
const ready = () => page.waitForFunction(() => !document.querySelector('[data-local-library][aria-busy="true"]')
  && document.querySelector('.page-actions button:last-child')?.disabled === false);

try {
  await page.evaluate(installLibraryFixture);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '播放 已有影片', exact: true }).waitFor();
  await openFile.click();
  await ready();
  assert.equal(await page.locator('.page-top h1').innerText(), '首页');
  assert.equal(await page.getByRole('button', { name: '播放 已有影片', exact: true }).count(), 1);
  assert.equal(await page.locator('.toast').count(), 0);
  checks.push('canceling file selection keeps the current page and existing library without success feedback');

  await configure({ hold: true, mode: 'normal' });
  const before = await count();
  await openFile.evaluate(button => { button.click(); button.click(); });
  await local.getByRole('status').filter({ hasText: '正在添加媒体' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '取消准备播放', exact: true }).count(), 0);
  assert.equal(await openFile.isDisabled(), true);
  assert.equal(await local.getByRole('button', { name: '添加目录', exact: true }).isDisabled(), true);
  assert.equal(await count(), before + 1);
  await page.getByRole('button', { name: '哔哩哔哩', exact: true }).click();
  await page.locator('.working-pill').filter({ hasText: '正在添加媒体' }).waitFor();
  await finish();
  await ready();
  assert.equal(await page.locator('.page-top h1').innerText(), '哔哩哔哩');
  await page.getByRole('button', { name: '本地片库', exact: true }).click();
  await page.getByRole('button', { name: '播放 新导入影片', exact: true }).waitFor();
  assert.equal(await local.locator('.library-toolbar > span').innerText(), '2 个媒体文件');
  checks.push('import is single-flight, has distinct activity feedback and updates data without redirecting a changed page');
  await page.locator('.toast').waitFor({ state: 'detached' });

  await configure({ hold: true, mode: 'error' });
  const scanBefore = await count();
  await page.getByRole('button', { name: '重新扫描', exact: true }).evaluate(button => { button.click(); button.click(); });
  await local.getByRole('status').filter({ hasText: '正在扫描片库' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '重新扫描', exact: true }).isDisabled(), true);
  assert.equal(await local.locator('.media-card').count(), 2);
  assert.equal(await count(), scanBefore + 1);
  await finish();
  await local.getByRole('alert').filter({ hasText: '目录暂时不可读取' }).waitFor();
  assert.equal(await local.locator('.media-card').count(), 2);
  assert.equal(await page.locator('.toast').count(), 0);
  await page.screenshot({ path: resolve(output, 'scan-error.png') });
  await configure({ mode: 'normal' });
  await local.getByRole('button', { name: '重试', exact: true }).click();
  await ready();
  assert.equal(await local.getByRole('alert').count(), 0);
  assert.equal(await page.evaluate(() => window.libraryTest.requests.at(-1).kind), 'rescan');
  checks.push('scan preserves old cards while busy or failed, rejects repeated clicks and retries the failed operation in place');

  await configure({ mode: 'empty' });
  await page.getByRole('button', { name: '添加目录', exact: true }).click();
  await local.getByRole('alert').filter({ hasText: '没有支持的媒体文件' }).waitFor();
  assert.equal(await local.locator('.media-card').count(), 2);
  await configure({ mode: 'normal' });
  await local.getByRole('button', { name: '重试', exact: true }).click();
  await ready();
  assert.equal(await page.evaluate(() => window.libraryTest.requests.at(-1).directory), true);
  await page.locator('.toast').filter({ hasText: '所选媒体已在片库中' }).waitFor();
  checks.push('empty and duplicate selections are distinguished; retry retains directory selection mode');

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await configure({ mode: 'normal' });
  await openFile.click();
  await page.waitForFunction(() => document.querySelector('.page-top h1')?.textContent === '本地片库');
  assert.equal(await local.locator('.media-card').count(), 2);
  await assertFrontendLayout(page, 'normal library');
  checks.push('successful selection navigates to the library only if the originating view remains current');

  await configure({ hold: true, mode: 'normal' });
  await page.getByRole('button', { name: '添加目录', exact: true }).click();
  await local.getByRole('status').waitFor();
  await page.getByRole('button', { name: '播放 已有影片', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
  const playingSession = await page.evaluate(() => window.reliability.resolves.at(-1).sessionId);
  await finish();
  await page.waitForFunction(() => window.libraryTest.running === 0);
  assert.equal(await page.locator('.player').count(), 1);
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).sessionId), playingSession);
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player'));
  checks.push('finishing an import during playback preserves the active viewing session');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '电视模式', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await configure({ hold: true, mode: 'normal' });
  await page.getByRole('button', { name: '重新扫描', exact: true }).click();
  await local.getByRole('status').waitFor();
  assert.equal(await local.getByRole('status').evaluate(node => getComputedStyle(node).fontSize), '16px');
  await assertFrontendLayout(page, 'TV library busy');
  await page.screenshot({ path: resolve(output, 'library-tv.png') });
  await finish();
  await ready();
  assert.equal(await page.evaluate(() => window.libraryTest.maximum), 1);
  assert.deepEqual(errors, []);
  checks.push('normal desktop and TV library states fit the layout without hiding existing media');
  const result = { result: 'passed', headless: true, fixtureFilePicker: true, checks, errors };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await session.close();
}
