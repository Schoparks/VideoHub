import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const page = connection.pages.find(page => !page.url.includes('/backend/'));
const output = '.tmp/android-bilibili-smoke';
await mkdir(output, { recursive: true });
const report = { qrs: [], searches: [], keyboard: undefined, passed: false };
try {
  await page.wait(() => window.hub && document.querySelector('.global-search input'));
  // No scan, poll, credentials or QR images are saved. Each generated code is canceled.
  for (const type of ['app', 'web']) {
    const result = await page.evaluate(async type => {
      let qr;
      try {
        qr = await window.hub.login(type);
        return { type, success: true, image: qr.image.startsWith('data:image/png') };
      } catch (error) { return { type, success: false, error: error.message }; }
      finally { if (qr) await window.hub.cancelLogin(qr.id); }
    }, type);
    report.qrs.push(result);
  }
  for (const searchType of ['video', 'media_bangumi']) {
    report.searches.push(await page.evaluate(async searchType => {
      try {
        const result = await window.hub.browse({ kind: 'search', keyword: '猫', page: 1, searchType });
        return { searchType, success: true, items: result.items.length };
      } catch (error) { return { searchType, success: false, error: error.message }; }
    }, searchType));
  }
  await page.evaluate(() => document.querySelector('.global-search input').focus());
  await connection.command(['shell', 'input', 'keyevent', '23']);
  await page.wait(() => document.querySelector('.screen-keyboard'));
  for (const letter of ['s', 'h', 'i']) {
    await page.evaluate(letter => [...document.querySelectorAll('.keyboard-row button')]
      .find(button => button.textContent === letter).click(), letter);
  }
  await page.wait(() => document.querySelector('.candidate-row button'));
  report.keyboard = await page.evaluate(() => [...document.querySelectorAll('.candidate-row button')].map(node => {
    const rect = node.getBoundingClientRect();
    return { text: node.textContent, width: rect.width, height: rect.height, x: rect.x, y: rect.y };
  }));
  await writeFile(`${output}/keyboard.png`, await connection.command(['exec-out', 'screencap', '-p']));
  if (process.env.YINGJI_ANDROID_EXPECT_FIXED === '1') {
    assert.ok(report.keyboard.length === 5 && report.keyboard.every(button => button.width >= 50 && button.height >= 40));
    assert.ok(report.qrs.every(qr => qr.success && qr.image));
    assert.ok(report.searches.every(search => search.success && search.items > 0));
    await page.evaluate(() => document.querySelector('.candidate-row button').focus());
    await connection.command(['shell', 'input', 'keyevent', '23']);
    await page.wait(() => document.querySelector('[aria-label="待选拼音"]').textContent === '拼音');
    assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"] input').value), report.keyboard[0].text);
  }
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await connection.close();
}
