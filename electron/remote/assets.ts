import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const controllerHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer"><title>映集遥控器</title>
<link rel="stylesheet" href="/remote.css"></head>
<body><div id="root"></div><script src="/remote.js"></script></body></html>`;

export async function controllerAssets(directory: string) {
  const [js, css] = await Promise.all(['remote.js', 'remote.css'].map(file => readFile(join(directory, file))));
  return new Map([
    ['/', { mime: 'text/html; charset=utf-8', body: Buffer.from(controllerHtml) }],
    ['/remote.js', { mime: 'text/javascript; charset=utf-8', body: js }],
    ['/remote.css', { mime: 'text/css; charset=utf-8', body: css }],
  ]);
}
