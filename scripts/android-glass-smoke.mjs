import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';
import { phoneMediaFixture } from './phone-media-fixture.mjs';

const output = '.tmp/android-glass';
await mkdir(output, { recursive: true });
const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const { command } = connection;
const ui = connection.pages.find(page => page.url.endsWith('/index.html') && !page.url.includes('/backend/'));
assert.ok(ui);
const report = [];
const sample = await phoneMediaFixture();
const media = createServer((request, response) => {
  assert.equal(request.headers.cookie, undefined);
  const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), sample.length - 1) : sample.length - 1;
  response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${sample.length}` } : {}) });
  response.end(sample.subarray(start, end + 1));
});
await new Promise(resolve => media.listen(0, '127.0.0.1', resolve));
let port;
const snapshot = async name => {
  await ui.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));
  await writeFile(`${output}/${name}.png`, await command(['exec-out', 'screencap', '-p']));
};
const material = selector => ui.evaluate(selector => {
  const node = document.querySelector(selector);
  const style = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return { background: style.backgroundColor, image: style.backgroundImage, filter: style.filter,
    width: rect.width, height: rect.height, overflow: node.scrollHeight - node.clientHeight };
}, selector);
try {
  assert.match((await command(['shell', 'dumpsys', 'webviewupdate'])).toString(), /66\.0\.3359\.158/);
  await ui.wait(() => document.querySelector('.nav-item') && window.hub);
  const boot = await ui.evaluate(() => window.hub.bootstrap());
  assert.equal(boot.account.app || boot.account.web, false);
  const capability = await ui.evaluate(() => ({ backdrop: CSS.supports('backdrop-filter', 'blur(1px)'),
    prefixed: CSS.supports('-webkit-backdrop-filter', 'blur(1px)'), filter: CSS.supports('filter', 'blur(1px)'),
    colorMix: CSS.supports('background', 'color-mix(in srgb, white 45%, transparent)'),
    material: document.documentElement.dataset.glassMaterial }));
  assert.deepEqual(capability, { backdrop: false, prefixed: false, filter: true, colorMix: false, material: 'fallback' });
  report.push({ capability });
  for (const theme of ['light', 'dark']) {
    await ui.evaluate(() => document.querySelector('.topbar button[aria-label="设置"]').click());
    await ui.wait(() => document.querySelector('.settings'));
    await ui.evaluate(theme => {
      const toggle = document.querySelector('input[aria-label="深色外观"]');
      if (toggle.checked !== (theme === 'dark')) toggle.click();
    }, theme);
    await ui.wait(theme => document.documentElement.dataset.theme === theme, theme);
    await ui.wait(() => document.querySelector('.app-shell')?.dataset.glassBlurred === 'true');
    assert.match((await material('.app-shell')).filter, /blur\(6px\)/);
    assert.equal((await material('.modal')).filter, 'none');
    assert.match((await material('.modal')).background, /^rgba\(/);
    assert.match((await material('.modal')).image, /linear-gradient/);
    assert.match((await material('.setting-row')).background, /^rgba\(/);
    assert.equal((await material('.modal')).overflow, 0);
    const button = await ui.evaluate(() => {
      const node = document.querySelector('.settings-tabs button');
      node.focus();
      window.dispatchEvent(new CustomEvent('hub-remote', { detail: 'confirm' }));
      return { kind: node.dataset.glassButton, pressed: node.dataset.glassPressed,
        rim: getComputedStyle(node, '::before').boxShadow,
        border: getComputedStyle(node, '::before').borderWidth,
        radius: getComputedStyle(node, '::before').borderRadius,
        light: getComputedStyle(node, '::after').backgroundImage,
        outline: getComputedStyle(node).outlineWidth };
    });
    assert.equal(button.kind, 'segment');
    assert.equal(button.pressed, 'true');
    assert.equal(button.rim, 'none');
    assert.equal(button.border, '2px');
    assert.equal(button.radius, '999px');
    assert.match(button.light, /radial-gradient/);
    assert.equal(button.outline, '0px');
    await ui.wait(() => !document.querySelector('[data-glass-pressed]'));
    await ui.evaluate(() => document.querySelector('input[aria-label="深色外观"]').focus());
    await snapshot(`${theme}-settings`);
    await ui.evaluate(() => document.querySelector('[aria-label="关闭弹窗"]').click());
    await ui.wait(() => !document.querySelector('.app-shell')?.hasAttribute('data-glass-blurred'));
    assert.equal((await material('.app-shell')).filter, 'none');
    assert.match((await material('.navigation-bar nav')).background, /^rgba\(/);
    await snapshot(`${theme}-home`);
    report.push({ theme, settings: 'translucent gradient and actual inactive browse blur; sharp text; no scrolling',
      dismissal: 'blur released' });
  }
  const state = await ui.evaluate(() => window.hub.controllerStatus());
  const url = new URL(state.urls[0]);
  port = url.port;
  await command(['forward', `tcp:${port}`, `tcp:${port}`]);
  const send = async value => {
    const response = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST',
      headers: { Authorization: `Bearer ${url.hash.slice(1)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value) });
    assert.deepEqual(await response.json(), {});
  };
  await send({ kind: 'url', text: `http://10.0.2.2:${media.address().port}/fixture.mp4` });
  await ui.wait(() => document.querySelector('video')?.videoWidth > 0 && document.querySelector('video').currentTime > .2);
  await send({ kind: 'action', action: 'pause' });
  await ui.wait(() => document.querySelector('video')?.paused === true);
  for (const selector of ['video', '.player', '.player-bottom', '.app-shell']) {
    assert.equal((await material(selector)).filter, 'none');
  }
  assert.match((await material('.player-bottom')).background, /^rgba\(/);
  assert.match((await material('.player-bottom')).image, /linear-gradient/);
  const playbackButton = await ui.evaluate(() => {
    const node = document.querySelector('.player-buttons button');
    return { kind: node.dataset.glassButton, film: getComputedStyle(node).backgroundImage,
      rim: getComputedStyle(node, '::before').boxShadow,
      border: getComputedStyle(node, '::before').borderWidth,
      focused: node === document.activeElement };
  });
  assert.equal(playbackButton.kind, 'playback');
  assert.match(playbackButton.film, /linear-gradient/);
  if (playbackButton.focused) {
    assert.equal(playbackButton.rim, 'none');
    assert.equal(playbackButton.border, '2px');
  } else assert.match(playbackButton.rim, /inset/);
  await snapshot('player');
  await ui.evaluate(() => document.querySelector('[aria-label="播放速度"]').click());
  await ui.wait(() => document.querySelector('.player-option-panel'));
  assert.match((await material('.player-option-panel')).background, /^rgba\(/);
  await snapshot('player-options');
  await ui.evaluate(() => window.dispatchEvent(new CustomEvent('hub-remote', { detail: 'back' })));
  await ui.wait(() => !document.querySelector('.player-option-panel'));
  await ui.evaluate(() => document.querySelector('[aria-label="播放设置"]').click());
  await ui.wait(() => document.querySelector('.settings'));
  await ui.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await material('.app-shell')).filter, 'none');
  assert.equal((await material('video')).filter, 'none');
  await snapshot('player-settings');
  assert.equal(await ui.evaluate(() => document.querySelectorAll('.glass-optics filter').length), 0);
  report.push({ player: 'real MP4 decode/pause; transparent control/menu layers; no video filter or SVG resources' });
  assert.deepEqual(ui.errors, []);
  await writeFile(`${output}/report.json`, JSON.stringify({ passed: true, report }, null, 2));
  console.log(JSON.stringify({ passed: true, report }, null, 2));
} finally {
  if (port) await command(['forward', '--remove', `tcp:${port}`]).catch(() => {});
  await connection.close();
  media.closeAllConnections();
  await new Promise(resolve => media.close(resolve));
}
