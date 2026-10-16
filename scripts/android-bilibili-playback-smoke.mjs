import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { connectLegacyWebViews } from './android-legacy-cdp.mjs';

const output = '.tmp/android-bilibili-playback';
await mkdir(output, { recursive: true });
const connection = await connectLegacyWebViews(process.env.YINGJI_ANDROID_SERIAL);
const page = connection.pages.find(page => !page.url.includes('/backend/'));
const backend = connection.pages.find(page => page.url.includes('/backend/'));
const report = { passed: false };
try {
  await page.wait(() => window.hub && document.querySelector('.global-search'));
  if (await page.evaluate(() => !!document.querySelector('.player'))) {
    await page.evaluate(() => document.querySelector('.player [data-player-leave]').click());
    await page.wait(() => !document.querySelector('.player'));
  }
  const bvid = process.env.YINGJI_ANDROID_BVID || await page.evaluate(async () => {
    const result = await window.hub.browse({ kind: 'search', keyword: '动画短片', page: 1, searchType: 'video' });
    return result.items[0].bvid;
  });
  report.bvid = bvid;
  const source = await page.evaluate(async bvid => {
    const item = await window.hub.openUrl(bvid);
    const source = window.__biliProbe = await window.hub.resolve(item);
    return { format: source.format, cid: source.part?.cid || source.item.cid, startAt: source.startAt };
  }, bvid);
  report.source = source;
  report.commentTransport = await backend.evaluate(async cid => {
    const response = await window.fetch(`https://comment.bilibili.com/${cid}.xml`, {
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Accept: 'text/xml', Referer: 'https://www.bilibili.com/' },
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, encoding: response.headers.get('content-encoding'),
      mime: response.headers.get('content-type'), firstBytes: [...bytes.slice(0, 8)],
      xml: new TextDecoder().decode(bytes.slice(0, 200)).includes('<i>') };
  }, source.cid);
  report.danmaku = await page.evaluate(async () => {
    try { return { count: (await window.hub.danmaku(window.__biliProbe.sessionId)).length }; }
    catch (error) { return { error: error.message }; }
    finally { await window.hub.release(window.__biliProbe.sessionId); delete window.__biliProbe; }
  });
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find(node => node.textContent.trim() === '打开链接').click());
  await page.wait(() => document.querySelector('.url-form input'));
  await page.evaluate(bvid => {
    const input = document.querySelector('.url-form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, bvid);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, bvid);
  await page.wait(bvid => document.querySelector('.url-form input').value === bvid, bvid);
  await page.evaluate(() => document.querySelector('.url-form button').focus());
  await connection.command(['shell', 'input', 'keyevent', '23']);
  await page.wait(() => document.querySelector('video'), undefined, 30000);
  try {
    await page.wait(() => {
      const video = document.querySelector('video');
      return video && video.videoWidth > 0 && video.webkitDecodedFrameCount > 0 && video.currentTime > .1;
    }, undefined, 30000);
  } catch { /* Save finite failure state without media URLs or account data. */ }
  report.playback = await page.evaluate(() => {
    const video = document.querySelector('video');
    return { width: video.videoWidth, frames: video.webkitDecodedFrameCount, position: video.currentTime,
      duration: video.duration, ready: video.readyState, error: video.error?.code,
      feedback: document.querySelector('.player-center')?.textContent };
  });
  await writeFile(`${output}/player.png`, await connection.command(['exec-out', 'screencap', '-p']));
  if (process.env.YINGJI_ANDROID_EXPECT_FIXED === '1') {
    assert.ok(report.danmaku.count > 0);
    assert.ok(report.commentTransport.xml);
    assert.ok(report.playback.width > 0 && report.playback.frames > 0 && report.playback.position > .1);
    await page.wait(position => document.querySelector('video').currentTime > position + 3, report.playback.position);
    report.sustained = await page.evaluate(() => {
      const video = document.querySelector('video');
      return { position: video.currentTime, frames: video.webkitDecodedFrameCount,
        audioBytes: video.webkitAudioDecodedByteCount };
    });
    assert.ok(report.sustained.frames > 20 && report.sustained.audioBytes > 0);
    await page.evaluate(() => {
      const button = document.querySelector('[aria-label="显示弹幕"]');
      if (button.getAttribute('aria-pressed') !== 'true') button.click();
    });
    await page.wait(() => !document.querySelector('.player')?.textContent.includes('弹幕加载失败'));
    await page.evaluate(() => document.querySelector('.player-buttons [data-focus-default]').focus());
    await connection.command(['shell', 'input', 'keyevent', '23']);
    await page.wait(() => document.querySelector('video').paused);
    const beforeSeek = await page.evaluate(() => document.querySelector('video').currentTime);
    await page.evaluate(() => document.querySelector('.timeline').focus());
    await connection.command(['shell', 'input', 'keyevent', '22']);
    await page.wait(() => document.querySelector('.player').dataset.seeking === 'true');
    await connection.command(['shell', 'input', 'keyevent', '23']);
    await page.wait(position => {
      const video = document.querySelector('video');
      return video.currentTime > position + 9 && video.paused && video.readyState >= 2;
    }, beforeSeek);
    report.seek = await page.evaluate(() => document.querySelector('video').currentTime);
    await page.evaluate(() => document.querySelector('.player-buttons [data-focus-default]').focus());
    await connection.command(['shell', 'input', 'keyevent', '23']);
    await page.wait(position => document.querySelector('video').currentTime > position + .3, report.seek);
    await writeFile(`${output}/player.png`, await connection.command(['exec-out', 'screencap', '-p']));
    assert.equal(await page.evaluate(() => document.querySelector('.player').textContent.includes('弹幕加载失败')), false);
    await page.evaluate(() => document.querySelector('.player [data-player-leave]').click());
    await page.wait(() => !document.querySelector('.player'));
    assert.deepEqual(page.errors, []);
    report.passed = true;
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  await connection.close();
}
