import { build as viteBuild } from 'vite';
import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bundleAndroidLicenses } from './android-licenses.mjs';
import { androidCssCompatibility } from './android-css-compatibility.mjs';

const output = resolve('.tmp/android-build/assets/web');
const manifest = await readFile('android/AndroidManifest.xml', 'utf8');
const version = /android:versionName="([\d.]+)-tv"/.exec(manifest)?.[1];
if (!version) throw new Error('Android manifest version is missing');
await viteBuild({
  css: { postcss: { plugins: [androidCssCompatibility] } },
  build: { outDir: output, emptyOutDir: true, sourcemap: false, target: 'chrome66', cssTarget: 'chrome66' },
});
await mkdir(`${output}/backend`, { recursive: true });
const aliases = new Map([
  [resolve('electron/accounts/vault.ts'), resolve('android/backend/vault.ts')],
  [resolve('electron/storage/store.ts'), resolve('android/backend/store.ts')],
  [resolve('electron/playback/gateway.ts'), resolve('android/backend/gateway.ts')],
]);
const nodeAliases = {
  'node:crypto': 'android/backend/crypto.ts',
  'node:fs/promises': 'android/backend/files.ts',
  'node:path': 'android/backend/path.ts',
};
await build({
  entryPoints: ['android/backend/entry.ts'], outfile: `${output}/backend/entry.js`,
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome66',
  define: { __YINGJI_ANDROID_VERSION__: JSON.stringify(version) },
  inject: [resolve('android/backend/buffer.ts'), resolve('android/backend/schema-integers.ts')], minify: true,
  plugins: [{
    name: 'android-platform-boundaries',
    setup(builder) {
      builder.onResolve({ filter: /^node:/ }, args => ({ path: resolve(nodeAliases[args.path] || '') }));
      builder.onResolve({ filter: /(?:vault|store|gateway)$/ }, args => {
        const target = resolve(args.resolveDir, `${args.path}.ts`);
        return aliases.has(target) ? { path: aliases.get(target) } : undefined;
      });
    },
  }],
});
await writeFile(`${output}/backend/index.html`, '<!doctype html><html><head><meta charset="UTF-8"></head><body><script src="./entry.js"></script></body></html>');
await copyFile('THIRD_PARTY_NOTICES.md', `${output}/THIRD_PARTY_NOTICES.md`);
await bundleAndroidLicenses(`${output}/licenses`);
console.log('Android frontend and isolated backend built');
