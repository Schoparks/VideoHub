import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { assertFrontendLayout } from './frontend-layout.mjs';
import { checkPlaybackSettings } from './renderer-settings-checks.mjs';
import { launchHeadlessRenderer } from './headless-renderer.mjs';

// No visible window, native input, desktop profile, credentials or platform requests.
const output = resolve('.tmp/renderer-reliability');
await mkdir(output, { recursive: true });
let session, page;
const checks = [];
try {
  session = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
  ({ page } = session);
  const { errors } = session;
  await page.getByRole('alert').filter({ hasText: '初始化读取失败' }).waitFor();
  await page.evaluate(() => { window.reliability.holdBootstrap = true; });
  await page.getByRole('button', { name: '重试', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => !!window.reliability.finishBootstrap);
  assert.equal(await page.evaluate(() => window.reliability.bootstrapCalls), 2);
  await page.evaluate(() => { window.reliability.holdBootstrap = false; window.reliability.finishBootstrap(); });
  const card = page.getByRole('button', { name: '播放 可靠性测试', exact: true });
  await card.waitFor();
  checks.push('initial errors retry; repeated bootstrap requests coalesce');

  const configure = value => page.evaluate(value => Object.assign(window.reliability, value), value);
  const play = async () => {
    await card.click();
    await page.waitForFunction(() => !!document.querySelector('video') && !document.querySelector('video').paused);
  };
  const leave = async () => {
    await page.getByRole('button', { name: '退出播放', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.player'));
  };
  const resolveCount = () => page.evaluate(() => window.reliability.resolves.length);

  await configure({ holdResolve: true });
  await card.click();
  await page.getByRole('button', { name: '取消准备播放', exact: true }).click();
  await page.evaluate(() => window.reliability.finishResolve());
  await page.waitForFunction(() => window.reliability.releases.length === 1);
  assert.equal(await page.locator('.player').count(), 0);
  checks.push('visible cancel releases a late source without opening playback');

  await page.locator('.card-details').click();
  await page.getByRole('button', { name: '立即播放', exact: true }).click();
  await page.waitForFunction(() => window.reliability.resolves.length === 2);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.evaluate(() => window.reliability.finishResolve());
  await page.waitForFunction(() => window.reliability.releases.length === 2);
  assert.equal(await page.locator('.player').count(), 0);
  checks.push('closing details cancels its pending play request');

  await configure({ holdResolve: false });
  await play();
  await configure({ holdProgress: true });
  const beforeSave = await resolveCount();
    await page.getByRole('button', { name: /^(下一集|播放队列下一项|下一项)$/ }).click();
  await page.waitForFunction(() => window.reliability.pendingProgress.length > 0);
  await page.getByRole('button', { name: '退出播放', exact: true }).click();
  await page.evaluate(() => {
    window.reliability.holdProgress = false;
    window.reliability.pendingProgress.forEach(finish => finish());
  });
  await page.waitForFunction(() => !document.querySelector('.player'));
  assert.equal(await resolveCount(), beforeSave);
  checks.push('leaving while local save waits suppresses the deferred episode transition');

  await play();
  await configure({ holdResolve: true });
  const beforeResolve = await resolveCount();
  await page.getByRole('button', { name: /^(下一集|播放队列下一项|下一项)$/ }).click();
  await page.waitForFunction(count => window.reliability.resolves.length > count, beforeResolve);
  await leave();
  await page.evaluate(() => window.reliability.finishResolve());
  await page.waitForFunction(() => window.reliability.releases.includes(window.reliability.resolves.at(-1).sessionId));
  assert.equal(await page.locator('.player').count(), 0);
  checks.push('leaving cancels an in-flight episode resolve and releases its late session');

  await configure({ holdResolve: false, omitParts: true, holdDetail: true });
  await play();
  const beforeDetail = await resolveCount();
  await page.getByRole('button', { name: /^(下一集|播放队列下一项|下一项)$/ }).click();
  await page.waitForFunction(() => !!window.reliability.finishDetail);
  await leave();
  await page.evaluate(() => window.reliability.finishDetail());
  await page.waitForTimeout(100);
  assert.equal(await resolveCount(), beforeDetail);
  checks.push('late episode metadata cannot restart a closed player');

  await configure({ holdDetail: false, omitParts: false, failRelease: true });
  await play();
  await leave();
  await page.locator('.toast').filter({ hasText: '退出保存失败' }).waitFor();
  assert.equal(await card.isVisible(), true);
  await configure({ failRelease: false });
  checks.push('failed release reports its error while browse content remains usable');

  await play();
  await configure({ holdBootstrap: true });
  await leave();
  await page.waitForFunction(() => !!window.reliability.finishBootstrap);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '深色外观', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: /^播放队列/ }).click();
  await page.locator('.queue-row').first().getByRole('button', { name: /^移除/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.queue-row').length === 1);
  await page.evaluate(() => { window.reliability.holdBootstrap = false; window.reliability.finishBootstrap(); });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.locator('.queue-row').count(), 1);
  checks.push('late bootstrap retains settings and queue edits made while refreshing');

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await play();
  await configure({ failNextBootstrap: true });
  await leave();
  await page.getByRole('alert').filter({ hasText: '初始化读取失败' }).waitFor();
  assert.equal(await card.isVisible(), true);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  checks.push('refresh failure retains loaded browse content and recovers with retry');
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 6000 });

  await page.evaluate(() => {
    window.reliability.detailOverride = {
      item: { ...window.reliability.boot.queue[0], title: '长标题边界内容'.repeat(22) },
      description: '需要能够完整阅读的简介。\n'.repeat(80),
      parts: Array.from({ length: 80 }, (_, index) => ({ id: `cid:${index + 1}`, cid: index + 1, title: `分集 ${index + 1}` })),
    };
  });
  await page.locator('.card-details').click();
  await page.getByRole('button', { name: '立即播放', exact: true }).waitFor();
  const assertPrimary = async label => {
    const visible = await page.getByRole('button', { name: '立即播放', exact: true }).evaluate(button => {
      const rect = button.getBoundingClientRect();
      return rect.y >= 0 && rect.bottom <= innerHeight
        && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    assert.equal(visible, true, `${label}: primary play must be visible and receive clicks`);
    await assertFrontendLayout(page, label);
  };
  await assertPrimary('long-details-initial');
  assert.equal(await page.locator('.detail-heading h1').getAttribute('tabindex'), null);
  assert.equal(await page.locator('.detail-heading h1').innerText(), '长标题边界内容'.repeat(22));
  await page.screenshot({ path: resolve(output, 'details-layout.png') });
  await page.getByRole('dialog').evaluate(dialog => { dialog.scrollTop = dialog.scrollHeight; });
  await assertPrimary('long-details-scrolled');
  await page.screenshot({ path: resolve(output, 'details-bottom.png') });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '电视模式', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('.card-details').click();
  await page.getByRole('button', { name: '立即播放', exact: true }).waitFor();
  await assertPrimary('television-details');
  await page.screenshot({ path: resolve(output, 'details-tv.png') });
  await page.getByRole('dialog').evaluate(dialog => { dialog.scrollTop = dialog.scrollHeight; });
  await assertPrimary('television-details-scrolled');
  await page.locator('.part-picker select').selectOption('cid:80');
  await page.getByRole('button', { name: '立即播放', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('video'));
  assert.equal(await page.evaluate(() => window.reliability.resolves.at(-1).part), 'cid:80');
  await leave();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('switch', { name: '电视模式', exact: true }).click();
  await page.getByRole('switch', { name: '深色外观', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.locator('.card-details').click();
  await page.getByRole('button', { name: '立即播放', exact: true }).waitFor();
  await assertPrimary('light-details');
  await page.screenshot({ path: resolve(output, 'details-light.png') });
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  checks.push('long title stays readable; primary play remains visible in normal desktop/dark, light and TV layouts; selecting episode 80 plays that episode');

  await configure({ foldersMode: 'error' });
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: 'B 站收藏', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '收藏夹读取失败' }).waitFor();
  const folderAttempts = await page.evaluate(() => window.reliability.foldersCalls);
  await configure({ foldersMode: 'normal' });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.getByRole('button', { name: '测试收藏夹', exact: false }).waitFor();
  await page.waitForFunction(() => window.reliability.browse.some(request => request.kind === 'favorites' && request.id === 1));
  assert.equal(await page.evaluate(() => window.reliability.foldersCalls), folderAttempts + 1);
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await configure({ foldersMode: 'empty' });
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: 'B 站收藏', exact: true }).click();
  await page.getByRole('heading', { name: '暂无收藏夹', exact: true }).waitFor();
  assert.equal(await page.locator('.media-card').count(), 0);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await configure({ foldersMode: 'loading' });
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: 'B 站收藏', exact: true }).click();
  await page.locator('main [role="status"]').waitFor();
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await configure({ foldersMode: 'error' });
  await page.evaluate(() => window.reliability.finishFolders());
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('alert').count(), 0);
  checks.push('favorites distinguish loading, empty and failure; retry reloads folders and late errors cannot change another page');
  checks.push(...await checkPlaybackSettings(page, output));

  await page.evaluate(() => {
    window.reliability.boot.history = [
      { item: { id: 'url:unfinished', source: 'url', kind: 'video', title: '未看完' }, position: 37, duration: 120, updatedAt: 3 },
      { item: { id: 'url:finished', source: 'url', kind: 'video', title: '已到片尾' }, position: 120, duration: 120, updatedAt: 2 },
      { item: { id: 'url:unknown', source: 'url', kind: 'video', title: '时长未知' }, position: 42, duration: 0, updatedAt: 1 },
    ];
  });
  await play();
  await leave();
  assert.equal(await page.getByRole('button', { name: '播放 已到片尾', exact: true }).count(), 0);
  await page.getByRole('button', { name: '全部记录', exact: true }).click();
  await page.getByRole('button', { name: '播放 已到片尾', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '播放 已到片尾', exact: true }).locator('.card-meta').innerText(), '从头播放');
  assert.equal(await page.getByRole('button', { name: '播放 未看完', exact: true }).locator('.card-meta').innerText(), '继续观看');
  assert.equal(await page.getByRole('button', { name: '播放 时长未知', exact: true }).locator('.duration').innerText(), '0:42');
  await assertFrontendLayout(page, 'history-state-labels');
  checks.push('history display matches resume policy; completed items restart and unknown duration still shows recorded position');

  assert.deepEqual(errors, []);
  const result = { result: 'passed', headless: true, simulatedMedia: true, checks, errors };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await session?.close();
}
