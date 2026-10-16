import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Record once, then replay without a live canvas/encoder competing with video decoding.
const browser = await chromium.launch({ headless: true, chromiumSandbox: true,
  channel: process.env.YINGJI_HEADLESS_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined) });
try {
  const page = await browser.newPage();
  const bytes = await page.evaluate(async () => {
    const mimeType = 'video/mp4;codecs=avc1.420028';
    if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error('测试浏览器不支持 H.264 MP4 录制');
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4000000 });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const ended = new Promise(resolve => { recorder.onstop = resolve; });
    let frame = 0;
    const timer = setInterval(() => {
      context.fillStyle = '#284a70';
      context.fillRect(0, 0, 1920, 1080);
      context.fillStyle = '#eeeeee';
      context.fillRect(frame++ * 8 % 1920, 120, 180, 800);
      context.font = '48px sans-serif';
      context.fillText(`1080P / 30 FPS / ${frame}`, 80, 80);
    }, 1000 / 30);
    recorder.start(500);
    await new Promise(resolve => setTimeout(resolve, 16000));
    recorder.stop();
    await ended;
    clearInterval(timer);
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await mkdir('.tmp/danmaku-video-smoke', { recursive: true });
  await writeFile('.tmp/danmaku-video-smoke/fixture.mp4', Buffer.from(bytes));
  console.log(`Recorded isolated 1080P H.264 fixture: ${bytes.length} bytes`);
} finally { await browser.close(); }
