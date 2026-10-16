import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchHeadlessRenderer } from './headless-renderer.mjs';
import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';
import { installPaginationFixture } from './browse-pagination-fixture.mjs';

export async function launchPaginationHarness(output) {
  if (process.env.YINGJI_HEADLESS === '1' || process.env.YINGJI_TEST_HEADLESS === '1') {
    const session = await launchHeadlessRenderer({ width: 1440, height: 950 }, installReliabilityFixture);
    const { page } = session;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('.media-card').waitFor();
    return {
      page, profile: 'headless fixture', close: session.close,
      evaluate: async callback => {
        const result = await page.evaluate(callback);
        // Electron keeps provider state across renderer reloads. Mirror that test
        // lifetime in sessionStorage when the fixture runs inside the renderer.
        await page.evaluate(() => sessionStorage.setItem('paginationState', JSON.stringify(globalThis.paginationSmoke)));
        return result;
      },
      install: async boot => {
        // Install the same provider fixture in the test realm, without Electron IPC.
        await page.addInitScript({ content: `{
          const handlers = new Map();
          (${installPaginationFixture.toString()})({ ipcMain: {
            removeHandler: name => handlers.delete(name),
            handle: (name, handler) => handlers.set(name, handler),
          } }, ${JSON.stringify(boot)});
          Object.assign(globalThis.paginationSmoke, JSON.parse(sessionStorage.getItem('paginationState') || '{}'));
          const api = window.hub;
          for (const [name, handler] of handlers) {
            api[name.slice(4)] = async (...args) => {
              const result = await handler(null, args);
              if (!result.ok) throw new Error(result.error);
              return result.data;
            };
          }
        }` });
      },
    };
  }
  const profile = await mkdtemp(resolve(output, 'profile-'));
  const env = { ...process.env, YINGJI_TEST_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const app = await electron.launch({ args: ['.'], cwd: resolve('.'), env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 950 });
  return { page, profile, close: () => app.close(),
    evaluate: callback => app.evaluate(callback),
    install: boot => app.evaluate(installPaginationFixture, boot) };
}
