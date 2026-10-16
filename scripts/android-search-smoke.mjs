import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const serial = process.env.YINGJI_ANDROID_SERIAL;
const label = process.env.YINGJI_SEARCH_LABEL || 'current';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid report label');
const output = '.tmp/android-search-smoke';
await mkdir(output, { recursive: true });
const connection = await connectLegacyWebViews(serial);
const page = connection.pages.find(page => !page.url.includes('/backend/'));
const report = { serial, label, searches: [], passed: false };
try {
  await page.wait(() => window.hub && document.querySelector('.global-search input'));
  const account = await page.evaluate(async () => {
    const boot = await window.hub.bootstrap();
    return { app: boot.account.app, web: boot.account.web };
  });
  assert.ok(!account.app && !account.web, 'This test only uses an anonymous isolated emulator');
  for (const searchType of ['all', 'media_ft']) {
    const result = await page.evaluate(async searchType => {
      const start = Date.now();
      try {
        const data = await window.hub.browse({ kind: 'search', keyword: '黑袍纠察队', page: 1, searchType });
        return { searchType, ms: Date.now() - start, count: data.items.length,
          seasons: data.items.filter(item => item.kind === 'season').map(item => ({ title: item.title, seasonId: item.seasonId })) };
      } catch (error) { return { searchType, ms: Date.now() - start, error: error.message }; }
    }, searchType);
    report.searches.push(result);
  }
  // Native input drives the product search/filter flow; the API results above are real.
  await page.evaluate(() => {
    const input = document.querySelector('.global-search input');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '黑袍纠察队');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.wait(() => document.querySelector('.feed-results[data-browse-ready="true"]'));
  await page.evaluate(() => [...document.querySelectorAll('.chips button')].find(node => node.textContent === '影视').focus());
  await connection.command(['shell', 'input', 'keyevent', '23']);
  await page.wait(() => document.querySelector('.chips button[aria-pressed="true"]')?.textContent === '影视'
    && document.querySelector('.feed-results[data-browse-ready="true"]'));
  report.ui = await page.evaluate(() => ({
    title: document.querySelector('main h1').textContent,
    items: [...document.querySelectorAll('main .media-card')].map(node => ({ id: node.dataset.mediaId, title: node.getAttribute('aria-label') })),
    error: document.querySelector('main [role="alert"]')?.textContent,
  }));
  await writeFile(`${output}/${label}.png`, await connection.command(['exec-out', 'screencap', '-p']));
  if (process.env.YINGJI_SEARCH_EXPECT_FILM === '1') {
    assert.ok(report.searches.every(search => search.seasons?.some(item => item.seasonId === 210727)));
    assert.ok(report.ui.items.some(item => item.id === 'season:210727'));
    const key = async code => {
      await connection.command(['shell', 'input', 'keyevent', String(code)]);
      await new Promise(resolve => setTimeout(resolve, 100));
    };
    const active = () => page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'),
      text: document.activeElement?.textContent, search: document.activeElement?.matches('.global-search input') }));
    await page.evaluate(() => document.querySelector('main .media-card').focus());
    await key(4);
    assert.equal((await active()).text, '影视');
    await key(4);
    assert.equal((await active()).label, '首页');
    await page.evaluate(() => document.querySelector('.navigation-bar > button').focus());
    await key(22);
    assert.equal((await active()).search, true);
    await key(22);
    assert.equal((await active()).label, '手柄屏幕键盘');
    await key(22);
    assert.equal((await active()).label, '管理 B 站账号');
    await page.evaluate(() => [...document.querySelectorAll('.navigation-bar nav button')]
      .find(node => node.getAttribute('aria-label') === '哔哩哔哩').click());
    await page.wait(() => document.querySelector('.tabs'));
    await page.evaluate(() => [...document.querySelectorAll('.tabs button')].find(node => node.textContent === '分区浏览').click());
    await page.wait(() => document.querySelector('.chips'));
    await page.evaluate(() => document.querySelector('.chips button').focus());
    await key(4);
    assert.equal((await active()).text, '分区浏览');
    await key(4);
    assert.equal((await active()).label, '哔哩哔哩');
    report.navigation = 'native right reaches search/account; native back ascends filters, tabs and primary header';
  }
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${output}/${label}.json`, JSON.stringify(report, null, 2));
  await connection.close();
}
