import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installPhoneCompanion } from './phone-companion-fixture.mjs';
import { checkPhoneLibrary } from './phone-library-checks.mjs';
import { checkPhoneNavigation } from './phone-navigation-checks.mjs';
import { checkPhoneBrowse } from './phone-browse-checks.mjs';

const output = resolve('.tmp/renderer-phone-controller');
await mkdir(output, { recursive: true });
await build({ entryPoints: ['electron/remote/server.ts'], bundle: true, platform: 'node', format: 'esm', outfile: `${output}/server.mjs` });
const { ControllerServer } = await import(pathToFileURL(`${output}/server.mjs`).href);
const report = [];
for (const viewport of [{ width: 1440, height: 950 }, { width: 1920, height: 1080 }]) {
  const { page, errors, close } = await launchHeadlessRenderer(viewport, installPhoneCompanion);
  const pending = new Map(), commands = [];
  const server = new ControllerServer(resolve('dist-electron/remote'), command => new Promise((resolveReply, reject) => {
    const id = randomUUID();
    commands.push(command);
    pending.set(id, resolveReply);
    void page.evaluate(request => window.receiveController(request), { id, command }).catch(reject);
  }));
  let context, phone;
  const checks = [];
  try {
    await page.exposeFunction('phoneReply', (id, reply) => { pending.get(id)?.(reply); pending.delete(id); });
    await page.exposeFunction('phoneStatus', () => server.start());
    await server.start();
    await page.getByRole('button', { name: '播放 可靠性测试', exact: true }).first().waitFor();
    const url = new URL(server.status().urls[0]);
    url.hostname = '127.0.0.1';
    const raw = async command => (await fetch(`${url.origin}/command`, {
      method: 'POST', headers: { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    })).json();
    context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    phone = await context.newPage();
    const phoneErrors = [];
    phone.on('pageerror', error => phoneErrors.push(error.message));
    await phone.goto(url.href);
    await phone.getByText('已连接电视', { exact: true }).waitFor();
    await phone.getByRole('button', { name: '播放 可靠性测试', exact: true }).waitFor();
    await phone.locator('.phone-cover img').first().waitFor();
    assert.equal(new URL(phone.url()).hash, '');
    await phone.screenshot({ path: `${output}/${viewport.width}-browse.png` });
    await phone.close();
    phone = await context.newPage();
    phone.on('pageerror', error => phoneErrors.push(error.message));
    await phone.goto(url.origin);
    await phone.getByText('已连接电视', { exact: true }).waitFor();
    checks.push('fresh tab with fragment-free address reconnects from remembered pairing');
    await checkPhoneBrowse(phone, page);
    checks.push('all six desktop sections; dynamics/reposts, regions, cinema/follows and all five personal filters');
    // Rapid fixture navigation intentionally exhausts part of the HTTP burst budget.
    // Let it refill before testing writes; never retry or replay a failed write.
    await phone.waitForTimeout(2000);

    await phone.getByRole('button', { name: '打开搜索', exact: true }).click();
    const search = phone.getByRole('searchbox', { name: '搜索关键词', exact: true });
    await search.fill('手机中文搜索');
    await search.dispatchEvent('compositionstart');
    await search.press('Enter');
    assert.equal(await page.evaluate(() => window.reliability.browse.some(request => request.keyword === '手机中文搜索')), false);
    await search.dispatchEvent('compositionend');
    await phone.waitForTimeout(40);
    await phone.getByRole('button', { name: '搜索', exact: true }).click();
    await phone.getByRole('button', { name: '播放 手机搜索结果：手机中文搜索', exact: true }).waitFor();
    await page.getByRole('heading', { name: '首页', exact: true }).waitFor();
    assert.equal(await page.locator('video').count(), 0);
    await phone.screenshot({ path: `${output}/${viewport.width}-search.png` });
    checks.push('IME guard; phone results show title and cover without changing television route');

    await phone.getByRole('button', { name: '工具', exact: true }).click();
    await phone.getByRole('button', { name: '设置', exact: true }).click();
    await phone.getByRole('switch', { name: '自动连播', exact: true }).click();
    await page.waitForFunction(() => window.reliability.boot.preferences.autoNext);
    await phone.getByLabel('B 站画质上限', { exact: true }).selectOption('80');
    await page.waitForFunction(() => window.reliability.boot.preferences.bilibiliMaxQuality === 80);
    await page.evaluate(() => { window.reliability.failPreference = true; });
    await phone.getByRole('button', { name: '弹幕', exact: true }).click();
    await phone.getByRole('switch', { name: '显示弹幕', exact: true }).click();
    await phone.getByText('操作失败，请重试', { exact: true }).waitFor();
    await phone.waitForFunction(() => !document.querySelector('input[role="switch"]:checked')?.disabled);
    assert.equal(await phone.getByRole('switch', { name: '显示弹幕', exact: true }).isChecked(), false);
    await page.evaluate(() => { window.reliability.failPreference = false; });
    await phone.screenshot({ path: `${output}/${viewport.width}-settings.png` });
    checks.push('direct preferences, persisted quality limit and visible save failure with rollback');

    await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
    await phone.getByRole('button', { name: '播放 手机搜索结果：手机中文搜索', exact: true }).click();
    await page.locator('video').waitFor();
    await phone.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await phone.getByRole('button', { name: '播放 相关视频测试', exact: true }).waitFor();
    await phone.getByRole('button', { name: '暂停', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video').paused);
    await phone.getByRole('button', { name: '播放速度', exact: true }).click();
    await phone.getByRole('button', { name: '1.5×', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video').playbackRate === 1.5);
    const timeline = phone.getByRole('slider', { name: '播放进度', exact: true });
    await timeline.fill('42');
    assert.notEqual(await page.locator('video').evaluate(video => video.currentTime), 42);
    await phone.getByRole('button', { name: '跳转到此处', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video').currentTime === 42);
    const oldSession = (await raw({ kind: 'snapshot' })).state.player.session;
    await phone.getByRole('button', { name: '清晰度', exact: true }).click();
    await phone.getByRole('button', { name: '720P', exact: true }).click();
    await page.waitForFunction(() => window.reliability.resolves.at(-1).quality === 64);
    await page.waitForFunction(() => document.querySelector('video').paused && document.querySelector('video').currentTime === 42);
    assert.deepEqual(await raw({ kind: 'player', session: oldSession, command: { operation: 'toggle' } }), { error: 'canceled' });
    await phone.screenshot({ path: `${output}/${viewport.width}-player.png` });
    checks.push('phone-only play/pause, rate, confirmed seek, paused quality switch and stale session rejection');

    await page.evaluate(() => { window.reliability.failResolve = true; });
    await phone.getByRole('button', { name: '清晰度', exact: true }).click();
    await phone.getByRole('button', { name: '1080P', exact: true }).click();
    await phone.getByRole('dialog').getByText('操作失败，请重试', { exact: true }).waitFor();
    await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
    await page.evaluate(() => { window.reliability.failResolve = false; });
    await phone.getByRole('button', { name: '播放 相关视频测试', exact: true }).click();
    await phone.getByRole('heading', { name: '相关视频测试', exact: true }).waitFor();
    assert.equal(await page.locator('video').count(), 1);
    checks.push('actual resolution failure reaches phone; related item replaces television playback');
    await checkPhoneLibrary(phone, page, raw);
    await checkPhoneNavigation(phone, page, raw);
    checks.push('platform and fresh local history; episode change keeps minimized view; scroll restored; late play preserves a newer sheet');
    checks.push('TV-only QR, folder actions, queue reordering/removal/failure, home bubble and scroll-to-top');

    let local;
    // A successful mutation starts a list refresh; wait for that read lock, never replay a write.
    for (let attempt = 0; attempt < 20; attempt++) {
      local = await raw({ kind: 'catalog', collection: 'local' });
      if (local.error !== 'busy') break;
      await phone.waitForTimeout(50);
    }
    assert.ok(local.catalog, JSON.stringify(local));
    assert.equal(local.catalog.items[0].title, '本地样片');
    assert.equal(JSON.stringify(local).includes('/private/'), false);
    await phone.getByRole('button', { name: '工具', exact: true }).click();
    await phone.getByRole('button', { name: '设置', exact: true }).click();
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await phone.setViewportSize(size);
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const header = await phone.locator('.companion-header').boundingBox();
      assert.equal(header.y, 0);
      assert.ok(header.height <= 60);
      assert.equal(await phone.locator('.companion-tabs').count(), 0);
      for (const name of ['观看', '弹幕', '界面']) {
        await phone.getByRole('button', { name, exact: true }).click();
        const dimensions = await phone.getByRole('dialog').evaluate(dialog => ({
          overflow: dialog.scrollHeight - dialog.clientHeight,
          outside: dialog.getBoundingClientRect().bottom > innerHeight,
          center: Math.abs(dialog.getBoundingClientRect().top + dialog.getBoundingClientRect().height / 2 - innerHeight / 2),
        }));
        assert.ok(dimensions.overflow <= 1, JSON.stringify({ size, name, dimensions }));
        assert.equal(dimensions.outside, false);
        assert.ok(dimensions.center <= 1, JSON.stringify(dimensions));
      }
      await phone.getByRole('button', { name: '观看', exact: true }).click();
      await phone.screenshot({ path: `${output}/${viewport.width}-layout-${size.width}.png` });
    }
    await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
    await phone.getByRole('button', { name: '工具', exact: true }).click();
    await phone.getByRole('button', { name: '按键', exact: true }).click();
    await phone.getByRole('button', { name: '自定义快捷键', exact: true }).click();
    await phone.getByLabel('快捷键 1', { exact: true }).selectOption('menu');
    await phone.getByRole('dialog').last().getByRole('button', { name: '关闭卡片', exact: true }).click();
    const countActions = () => commands.filter(command => command.kind === 'action').length;
    const down = phone.getByRole('button', { name: '下', exact: true });
    await down.evaluate(button => button.scrollIntoView({ block: 'center' }));
    assert.equal(await down.evaluate(button => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true);
    const box = await down.boundingBox();
    const before = countActions();
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.mouse.down();
    await phone.waitForTimeout(600);
    await down.dispatchEvent('pointercancel', { pointerId: 1 });
    await phone.mouse.up();
    const stopped = countActions();
    await phone.waitForTimeout(350);
    assert.equal(countActions(), stopped);
    assert.ok(stopped > before);
    await phone.getByRole('button', { name: '关闭卡片', exact: true }).click();
    await phone.getByRole('button', { name: '工具', exact: true }).click();
    await phone.getByRole('button', { name: '设置', exact: true }).click();
    await phone.getByRole('button', { name: '界面', exact: true }).click();
    await phone.getByRole('button', { name: '忘记此连接', exact: true }).click();
    await phone.getByText('请扫描应用中的遥控二维码', { exact: true }).waitFor();
    await phone.goto(url.href);
    await phone.getByText('已连接电视', { exact: true }).waitFor();
    checks.push('forget pairing and scan again in the same document without reload');
    await server.stop();
    await phone.getByText('未连接', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(phoneErrors, []);
    checks.push('opaque local media handles; portrait/landscape bounds; hold cancellation; disconnection');
    report.push({ viewport, passed: true, checks });
  } catch (error) {
    await phone?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
    throw error;
  } finally {
    await server.stop();
    await context?.close();
    await close();
  }
}
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
