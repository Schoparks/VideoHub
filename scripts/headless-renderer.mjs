import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

/** A production renderer with no visible window, system input or desktop profile. */
export async function launchHeadlessRenderer(viewport, install) {
  const dist = resolve('dist');
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      const file = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(dist + sep)) throw new Error('outside build');
      const mime = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.svg': 'image/svg+xml', '.png': 'image/png',
      }[extname(file)] || 'application/octet-stream';
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const close = async () => {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  };
  try {
    browser = await chromium.launch({
      headless: true, chromiumSandbox: true,
      channel: process.env.YINGJI_HEADLESS_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    });
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(install);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    return { page, errors, close };
  } catch (error) {
    await close();
    throw error;
  }
}
