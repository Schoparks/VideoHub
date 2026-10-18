import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const output = '.tmp/android-settings-layout';
await mkdir(output, { recursive: true });
let connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const { command } = connection;
let ui = connection.pages.find(page => page.url.endsWith('/index.html') && !page.url.includes('/backend/'));
assert.ok(ui);
const report = [];
try {
  await ui.evaluate(async () => {
    const boot = await window.hub.bootstrap();
    if (boot.account.app || boot.account.web) throw new Error('测试必须使用匿名隔离配置');
    await window.hub.preferences({ ...boot.preferences, theme: 'light', tvMode: true, cardColumns: 0 });
  });
  await connection.close();
  // Bundle navigation is intentionally blocked; recreate only the isolated test process.
  await command(['shell', 'am', 'force-stop', 'app.yingji.tv']);
  await command(['shell', 'am', 'start', '-W', '-n', 'app.yingji.tv/.MainActivity']);
  connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
  ui = connection.pages.find(page => page.url.endsWith('/index.html') && !page.url.includes('/backend/'));
  await ui.wait(() => document.documentElement.dataset.theme === 'light'
    && document.querySelector('.nav-item') && !document.querySelector('.player') && window.hub);
  await ui.evaluate(() => document.querySelector('.topbar button[aria-label="设置"]').click());
  await ui.wait(() => document.querySelector('.settings-tabs'));
  for (const section of ['观看', '弹幕', '手机遥控', '手柄']) {
    await ui.evaluate(name => Array.from(document.querySelectorAll('[role="tab"]'))
      .find(node => node.textContent === name).click(), section);
    if (section === '手机遥控') await ui.wait(() => document.querySelector('img[alt="手机遥控二维码"]'));
    const layout = await ui.evaluate(() => {
      const modal = document.querySelector('.modal');
      const rect = modal.getBoundingClientRect();
      return { viewport: [innerWidth, innerHeight], width: rect.width, height: rect.height,
        overflow: modal.scrollHeight - modal.clientHeight, inside: rect.top >= 0 && rect.bottom <= innerHeight,
        selected: document.querySelector('[role="tab"][aria-selected="true"]').textContent,
        labels: Array.from(document.querySelectorAll('.settings-panel [aria-label]')).map(node => node.getAttribute('aria-label')) };
    });
    assert.deepEqual(layout.viewport, [1920, 1080]);
    assert.equal(layout.selected, section);
    assert.ok(layout.overflow <= 1);
    assert.equal(layout.inside, true);
    report.push({ section, ...layout });
    await ui.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
    await writeFile(`${output}/${section}.png`, await command(['exec-out', 'screencap', '-p']));
  }
  assert.deepEqual(ui.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: true, report }, null, 2));
  console.log(JSON.stringify({ passed: true, report }, null, 2));
} finally { await connection.close(); }
