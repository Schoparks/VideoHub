import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

await mkdir('.tmp/anonymous-content', { recursive: true });
await build({
  stdin: {
    resolveDir: process.cwd(),
    contents: `
      import { BilibiliProvider } from './electron/providers/bilibili';
      import { BilibiliAccount } from './electron/accounts/bilibili-account';
      import { Vault } from './electron/accounts/vault';
      import { fetchCover } from './electron/images';
      import { writeFile } from 'node:fs/promises';
      (async () => {
      const flags = [];
      const fetcher = async (input, init) => {
        const response = await fetch(input, init);
        if (String(input).includes('/pgc/player/')) {
          const payload = await response.clone().json();
          const video = payload.result?.video_info ?? payload.result ?? payload.data;
          flags.push({ fnval: new URL(String(input)).searchParams.get('fnval'),
            code: payload.code, drm: video?.is_drm, preview: video?.is_preview,
            quality: video?.quality, format: video?.format });
        }
        return response;
      };
      const vault = new Vault('', { available: () => false, encrypt: Buffer.from, decrypt: value => value.toString() });
      const provider = new BilibiliProvider(new BilibiliAccount(vault, fetcher));
      const report = { anonymous: true, movie: {}, liveSearch: {} };
      try {
        const detail = await provider.detail({ id: 'episode:278480', source: 'bilibili',
          kind: 'season', episodeId: 278480, title: '幸福终点站' });
        report.movie.title = detail.item.title;
        report.movie.episodeId = detail.parts[0]?.episodeId;
        await provider.play(detail.item, detail.parts[0]);
        report.movie.resolved = true;
      } catch (error) { report.movie.error = error.message; }
      report.movie.flags = flags;
      try {
        const page = await provider.browse({ kind: 'search', searchType: 'live_room', keyword: '游戏' });
        report.liveSearch.count = page.items.length;
        report.liveSearch.validReferences = page.items.every(item => item.kind === 'live' && item.roomId > 0);
        const item = page.items.find(item => item.cover);
        if (item) {
          const response = await fetchCover(item.cover);
          report.liveSearch.coverStatus = response.status;
          report.liveSearch.coverMime = response.headers.get('content-type');
          report.liveSearch.coverBytes = (await response.arrayBuffer()).byteLength;
        }
      } catch (error) { report.liveSearch.error = error.message; }
      await writeFile('.tmp/anonymous-content/result.json', JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      })().catch(error => { console.error(error.message); process.exitCode = 1; });
    `,
  },
  outfile: '.tmp/anonymous-content/probe.cjs', bundle: true,
  platform: 'node', format: 'cjs', target: 'node22',
});
const child = spawn(process.execPath, ['.tmp/anonymous-content/probe.cjs'], { stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code || 0; });
