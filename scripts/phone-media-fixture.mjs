import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { recordAdaptiveFixture } from './webpage-media-fixture.mjs';

/** Original, local H.264 sample for both native phone-control smoke tests. */
export async function phoneMediaFixture() {
  const output = '.tmp/phone-control-media';
  await mkdir(output, { recursive: true });
  try { return await readFile(`${output}/fixture.mp4`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const browser = await chromium.launch({ headless: true,
    channel: process.env.YINGJI_HEADLESS_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
  try {
    const page = await browser.newPage();
    await recordAdaptiveFixture(page, output, 8000);
    return await readFile(`${output}/fixture.mp4`);
  } finally { await browser.close(); }
}
