import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { connectPad, pressPad } from './controller-fixture.mjs';

const output = resolve('.tmp/renderer-collection');
await mkdir(output, { recursive: true });
const session = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
const { page, errors } = session;
const checks = [];
const press = index => pressPad(page, index, 80);
const focus = locator => locator.evaluate(button => { button.scrollIntoView({ block: 'nearest' }); button.focus(); });
const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim());
const configure = value => page.evaluate(value => Object.assign(window.collectionTest, value), value);
const finish = () => page.evaluate(() => window.collectionTest.finish());
try {
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.evaluate(() => {
    const base = window.reliability.boot.queue[0];
    const state = window.collectionTest = {
      items: [base, { ...base, id: 'bili:second', title: '第二项' }, { ...base, id: 'bili:third', title: '第三项' }],
      watch: [], favorite: [], watchWrites: [], favoriteWrites: [], collectionReads: [],
      failWrite: true, failRead: false, holdWrite: true, loginWrites: [], canceled: [], holdLogin: true, failLogin: true,
    };
    const browse = window.hub.browse;
    window.hub.browse = async request => {
      if (!['watchlater', 'favorites'].includes(request.kind)) return browse(request);
      state.collectionReads.push({ ...request });
      if (state.failRead) throw new Error('列表刷新失败');
      return { items: structuredClone(request.kind === 'watchlater' ? state.watch : state.favorite), hasMore: false };
    };
    const write = async () => {
      if (state.holdWrite) await new Promise(resolve => { state.finish = resolve; });
      if (state.failWrite) throw new Error('平台保存失败');
    };
    window.hub.watchLater = async (item, add) => {
      state.watchWrites.push({ id: item.id, add });
      await write();
      state.watch = state.watch.filter(existing => existing.id !== item.id);
      if (add) state.watch.push(item);
    };
    window.hub.favorite = async (item, folder, add) => {
      state.favoriteWrites.push({ id: item.id, folder, add });
      await write();
      state.favorite = state.favorite.filter(existing => existing.id !== item.id);
      if (add) state.favorite.push(item);
    };
    window.hub.folders = async () => {
      window.reliability.foldersCalls++;
      if (window.reliability.foldersMode === 'loading') await new Promise(resolve => { state.finish = resolve; });
      return [{ id: 1, title: '测试收藏夹', count: state.favorite.length }, { id: 2, title: '另一个收藏夹', count: 0 }];
    };
    window.hub.login = async type => {
      state.loginWrites.push(type);
      if (state.holdLogin) await new Promise(resolve => { state.finish = resolve; });
      if (state.failLogin) throw new Error('二维码生成失败');
      return { id: `qr-${state.loginWrites.length}`, type, image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' };
    };
    window.hub.pollLogin = async () => ({ state: 'waiting' });
    window.hub.cancelLogin = async id => { state.canceled.push(id); };
    window.hub.logout = async () => {
      state.logoutCalls = (state.logoutCalls || 0) + 1;
      await new Promise(resolve => { state.finish = resolve; });
      return { app: false, web: false, storage: 'memory' };
    };
  });
  await connectPad(page);
  await page.waitForTimeout(200);
  await focus(page.locator('.media-card').first());
  await press(2);
  const watch = () => page.locator('.detail-actions').getByRole('button', { name: /^(稍后再看|移出稍后再看)$/ });
  await watch().waitFor();
  await focus(watch());
  await press(0);
  assert.equal(await focused(), '稍后再看');
  await press(0);
  assert.equal(await page.evaluate(() => window.collectionTest.watchWrites.length), 1);
  await finish();
  await page.locator('.toast').filter({ hasText: '平台保存失败' }).waitFor();
  assert.equal(await focused(), '稍后再看');
  assert.equal(await watch().innerText(), '稍后再看');
  checks.push('pending/failed watch-later writes retain focus, reject repeated confirmation and do not publish success');

  await configure({ failWrite: false });
  await press(0);
  await finish();
  await page.getByRole('button', { name: '移出稍后再看', exact: true }).waitFor();
  assert.equal(await focused(), '移出稍后再看');
  await press(0);
  await finish();
  await page.locator('.detail-actions').getByRole('button', { name: '稍后再看', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.collectionTest.watchWrites.map(write => write.add)), [true, true, false]);
  checks.push('successful watch-later actions update the next action and removal sends the opposite platform operation');
  await press(1);

  await page.evaluate(() => { window.collectionTest.watch = structuredClone(window.collectionTest.items); });
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.getByRole('button', { name: '播放 第二项', exact: true }).waitFor();
  await focus(page.getByRole('button', { name: '播放 第二项', exact: true }));
  await press(2);
  await focus(watch());
  await press(0);
  await finish();
  await page.locator('.detail-actions').getByRole('button', { name: '稍后再看', exact: true }).waitFor();
  await press(1);
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-media-id') === 'bili:third');
  assert.equal(await page.getByRole('button', { name: '播放 第二项', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.collectionTest.collectionReads.at(-1).refresh), true);
  checks.push('confirmed removal updates its cached list, refreshes after closing and returns focus to the next surviving card');

  await press(2);
  await configure({ failRead: true });
  await focus(watch());
  await press(0);
  await finish();
  await page.locator('.detail-actions').getByRole('button', { name: '稍后再看', exact: true }).waitFor();
  await press(1);
  await page.getByRole('alert').filter({ hasText: '列表刷新失败' }).waitFor();
  assert.equal(await page.locator('.media-card').count(), 1);
  await configure({ failRead: false });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
  checks.push('post-write refresh errors retain the authoritative surviving list and retry the failed refresh');

  await focus(page.locator('.media-card').first());
  await press(2);
  const favorite = page.getByRole('button', { name: '收藏', exact: true });
  await page.evaluate(() => { window.reliability.foldersMode = 'loading'; });
  await focus(favorite);
  await press(0);
  assert.equal(await focused(), '正在加载…');
  await press(0);
  await finish();
  const folder = page.getByRole('combobox', { name: 'B 站收藏夹', exact: true });
  await folder.waitFor();
  await page.evaluate(() => { window.reliability.foldersMode = 'normal'; });
  await configure({ failWrite: true });
  await focus(page.getByRole('button', { name: '确认收藏', exact: true }));
  await press(0);
  assert.equal(await focused(), '确认收藏');
  await focus(folder);
  await press(15);
  assert.equal(await folder.inputValue(), '1');
  await focus(page.getByRole('button', { name: '确认收藏', exact: true }));
  await press(0);
  assert.equal(await page.evaluate(() => window.collectionTest.favoriteWrites.length), 1);
  await finish();
  await page.locator('.toast').filter({ hasText: '平台保存失败' }).waitFor();
  assert.equal(await focused(), '确认收藏');
  assert.equal(await page.locator('.favorite-panel').count(), 1);
  assert.equal(await page.evaluate(() => window.collectionTest.favorite.length), 0);
  await configure({ failWrite: false });
  await press(0);
  await finish();
  await page.waitForFunction(() => !document.querySelector('.favorite-panel'));
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '收藏');
  assert.equal(await focused(), '收藏');
  await press(1);
  await page.getByRole('button', { name: 'B 站收藏', exact: true }).click();
  await page.locator('.media-card').first().waitFor();
  assert.equal(await page.evaluate(() => window.collectionTest.collectionReads.at(-1).kind), 'favorites');
  assert.equal(await page.evaluate(() => window.collectionTest.collectionReads.at(-1).refresh), true);
  assert.equal(await page.evaluate(() => window.reliability.browse.filter(request => request.kind === 'recommend').length), 1);
  checks.push('folder loading/save keeps focus, busy selection is locked, success collapses the panel and invalidates only its collection');

  await focus(page.locator('.media-card').first());
  await press(2);
  assert.equal(await watch().innerText(), '移出稍后再看');
  await focus(watch());
  await press(0);
  await press(1);
  await page.getByRole('button', { name: '番剧与影视', exact: true }).click();
  await finish();
  await page.waitForTimeout(150);
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('heading', { name: '番剧与影视', exact: true }).count(), 1);
  await page.getByRole('button', { name: '我的收藏', exact: true }).click();
  await page.waitForFunction(() => window.collectionTest.collectionReads.at(-1)?.kind === 'watchlater'
    && !document.querySelector('.loading'));
  assert.equal(await page.locator('.media-card').count(), 0);
  assert.equal(await page.evaluate(() => window.collectionTest.collectionReads.at(-1).refresh), true);
  checks.push('a late confirmed write after closing cannot reopen details or replace another feed, but invalidates its collection');

  await page.getByRole('button', { name: '管理 B 站账号', exact: true }).click();
  const auth = page.getByRole('button', { name: /App 推荐授权/ });
  await focus(auth);
  await press(0);
  assert.ok((await focused()).includes('App 推荐授权'));
  await press(0);
  assert.equal(await page.evaluate(() => window.collectionTest.loginWrites.length), 1);
  await finish();
  await page.getByRole('alert').filter({ hasText: '二维码生成失败' }).waitFor();
  assert.ok((await focused()).includes('App 推荐授权'));
  await configure({ failLogin: false });
  await press(0);
  await finish();
  await page.getByAltText('B 站登录二维码').waitFor();
  await focus(page.getByRole('button', { name: '刷新二维码', exact: true }));
  await press(0);
  assert.equal(await focused(), '刷新二维码');
  await finish();
  await page.getByAltText('B 站登录二维码').waitFor();
  assert.equal(await focused(), '刷新二维码');
  await focus(page.getByRole('button', { name: '断开本机账号', exact: true }));
  await press(0);
  await page.getByRole('status').filter({ hasText: '正在断开账号…' }).waitFor();
  assert.equal(await focused(), '断开本机账号');
  await press(0);
  assert.equal(await page.evaluate(() => window.collectionTest.logoutCalls), 1);
  await finish();
  await page.waitForFunction(() => !document.querySelector('.loading'));
  checks.push('account generation/failure/refresh retain the initiating focus; logout has its own status and rejects duplicate confirmation');
  await page.screenshot({ path: resolve(output, 'account.png') });
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors, output }, null, 2));
} finally { await session.close(); }
