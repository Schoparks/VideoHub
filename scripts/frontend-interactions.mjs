import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { frontendFixture, installFrontendFixture, installFrontendImages } from './frontend-fixture.mjs';
import { installInteractionFixture } from './frontend-interaction-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';
import { assertFrontendLayout } from './frontend-layout.mjs';

const output = resolve('.tmp/frontend-interactions');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'profile-'));
const env = { ...process.env, YINGJI_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env, timeout: 30000 });
let page;
const checks = [], errors = [];
try {
  page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
  const boot = await page.evaluate(() => window.hub.bootstrap());
  const fixture = frontendFixture(boot);
  await app.evaluate(installFrontendFixture, fixture);
  await app.evaluate(installInteractionFixture, fixture);
  await installFrontendImages(page); await page.reload();
  await page.getByRole('alert').filter({ hasText: '初始化读取失败' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '连接 B 站', exact: true }).count(), 0);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 12);
  checks.push('bootstrap failure remains a visible error and retries real initialization');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dark = page.getByRole('switch', { name: '深色外观', exact: true });
  await dark.click();
  await page.locator('.toast').filter({ hasText: '设置保存失败' }).waitFor();
  assert.equal(await dark.isChecked(), false);
  await dark.click(); await dark.click();
  await app.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (globalThis.interactionSmoke.prefs.length === 3 && !globalThis.interactionSmoke.concurrency) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('preferences did not finish');
  });
  const preferences = await app.evaluate(() => globalThis.interactionSmoke);
  assert.equal(preferences.maximum, 1);
  assert.deepEqual(preferences.prefs.map(value => value.theme), ['dark', 'dark', 'light']);
  await page.keyboard.press('Escape');
  checks.push('failed settings roll back; rapid edits persist in order with maximum concurrency one');

  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: /^播放队列/ }).click();
  await page.locator('.queue-row').first().getByRole('button', { name: /^移除/ }).click();
  await page.locator('.toast').filter({ hasText: '队列保存失败' }).waitFor();
  assert.equal(await page.locator('.queue-row').count(), 2);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.locator('.card-details').nth(2).click();
  await page.getByRole('button', { name: '加入队列', exact: true }).click();
  await page.locator('.toast').filter({ hasText: '队列保存失败' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '已在队列中', exact: true }).count(), 0);
  assert.doesNotMatch(await page.locator('.toast').innerText(), /已加入/);
  checks.push('queue failure preserves list and never reports successful enqueue');

  await connectPad(page);
  await page.locator('.description').focus();
  await pressPad(page, 13);
  assert.ok(await page.locator('.description').evaluate(element => element.scrollTop > 0));
  await page.getByRole('button', { name: '收藏', exact: true }).focus(); await pressPad(page, 0);
  await page.getByRole('combobox', { name: 'B 站收藏夹', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'B 站收藏夹');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true);
  await assertFrontendLayout(page, 'details-long-content');
  await page.screenshot({ path: resolve(output, 'details.png') });
  await pressPad(page, 1);
  assert.equal(await page.locator('.favorite-panel').count(), 0);
  assert.equal(await page.getByRole('dialog').count(), 1);
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '收藏');
  await pressPad(page, 1);
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  checks.push('long description scrolls with D-pad; favorite picker focuses select and Back restores favorite opener before closing details');

  await page.getByRole('button', { name: '管理 B 站账号', exact: true }).click();
  await page.getByRole('button', { name: /App 推荐授权/ }).click();
  await page.getByRole('status').filter({ hasText: '正在生成二维码' }).waitFor();
  await page.keyboard.press('Escape');
  await app.evaluate(() => {
    globalThis.interactionSmoke.finishLogin({
      id: 'late-fixture-qr', type: 'app', expiresAt: Date.now() + 10000,
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD6sAAAAASUVORK5CYII=',
    });
  });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok((await app.evaluate(() => globalThis.interactionSmoke.cancelled)).includes('late-fixture-qr'));
  assert.equal(await page.locator('.qr-box').count(), 0);
  checks.push('closing pending authorization cancels its late QR result without reopening the dialog');

  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ result: 'passed', checks, errors }, null, 2));
  console.log(JSON.stringify({ result: 'passed', checks, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, 'failure.png'), timeout: 3000 }).catch(() => {});
  throw error;
} finally { await app.close(); }
