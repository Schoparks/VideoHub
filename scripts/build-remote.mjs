import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

export async function buildRemote(directory) {
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: ['src/phone/remote.tsx'], outfile: `${directory}/remote.js`,
    bundle: true, platform: 'browser', format: 'iife', target: 'es2020',
    minify: true, define: { 'process.env.NODE_ENV': '"production"' },
  });
  // The same HTML module is bundled by Electron and exported here without Node's TS loader.
  const html = await build({ entryPoints: ['electron/remote/assets.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  const { controllerHtml } = await import(`data:text/javascript;base64,${Buffer.from(html.outputFiles[0].text).toString('base64')}`);
  await writeFile(`${directory}/index.html`, controllerHtml);
}
