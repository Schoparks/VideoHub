import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Optional asset regeneration; ordinary builds use the checked-in PNG.
const source = await readFile(resolve('public/app-icon.svg'), 'utf8');
const browser = await chromium.launch({
  headless: true,
  chromiumSandbox: true,
  channel: process.env.YINGJI_HEADLESS_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
});
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0">${source}</body></html>`);
  await page.locator('svg').screenshot({ path: resolve('public/app-icon-512.png'), omitBackground: true });
  console.log('Generated public/app-icon-512.png from public/app-icon.svg (512 × 512).');
} finally { await browser.close(); }
