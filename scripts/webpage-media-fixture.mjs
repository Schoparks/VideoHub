import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function recordAdaptiveFixture(page, output, duration = 4000) {
  const recording = await page.evaluate(async duration => {
    const mime = ['video/mp4;codecs=avc1.42001E', 'video/mp4'].find(value => MediaRecorder.isTypeSupported(value));
    if (!mime) throw new Error('当前 Electron 不支持 MP4 录制');
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const ended = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start(400);
    let frame = 0;
    const timer = setInterval(() => {
      context.fillStyle = frame++ % 2 ? '#315f4e' : '#402f61';
      context.fillRect(0, 0, 320, 180);
      context.fillStyle = '#fff';
      context.font = '20px sans-serif';
      context.fillText(`WEBPAGE TEST ${frame}`, 25, 90);
    }, 80);
    await new Promise(resolve => setTimeout(resolve, duration));
    recorder.stop();
    await ended;
    clearInterval(timer);
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  }, duration);
  const mp4 = Buffer.from(recording);
  await writeFile(join(output, 'fixture.mp4'), mp4);
  const init = [], segments = [];
  for (let offset = 0; offset < mp4.length;) {
    const length = mp4.readUInt32BE(offset);
    if (length < 8 || offset + length > mp4.length) throw new Error('无效录制媒体结构');
    const box = mp4.subarray(offset, offset + length);
    const type = box.toString('ascii', 4, 8);
    (['ftyp', 'moov'].includes(type) ? init : segments).push(box);
    offset += length;
  }
  const avc = mp4.indexOf(Buffer.from('avcC'));
  if (avc < 0) throw new Error('录制媒体缺少 H264 配置');
  const codec = `avc1.${mp4.subarray(avc + 5, avc + 8).toString('hex')}`;
  return { mp4, init: Buffer.concat(init), segment: Buffer.concat(segments), codec };
}

export async function createWebpageFixture(page, output) {
  const adaptive = await recordAdaptiveFixture(page, output);
  const webm = await readFile('.tmp/smoke/跨平台样片.webm');
  const requests = [];
  let generation = 0, recoveredAt = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const request = { path: url.pathname, generation: url.searchParams.get('v'), range: req.headers.range,
      referer: req.headers.referer, ownCookie: (req.headers.cookie || '').includes('web_fixture=1'),
      leaked: (req.headers.cookie || '').includes('daily_sentinel=1'), internalMarker: !!req.headers['x-yingji-media-request'] };
    requests.push(request);
    res.on('finish', () => { request.status = res.statusCode; });
    if (url.pathname === '/redirect-list.m3u8') {
      res.writeHead(302, { Location: '/adaptive/list.m3u8' });
      res.end();
      return;
    }
    if (url.pathname === '/redirect-decoy.mp4') {
      res.writeHead(302, { Location: '/decoy.mp4' });
      res.end();
      return;
    }
    const path = url.pathname.replace(/^\/adaptive\//, '/');
    const html = content => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'web_fixture=1; SameSite=Lax; Path=/' });
      res.end(`<title>第三方网页测试</title>${content}`);
    };
    if (url.pathname === '/plain') return html('<video width="640" height="360" src="/sample.webm"></video>');
    if (url.pathname === '/delayed') return html('<script>setTimeout(()=>document.body.innerHTML=\'<video src="/sample.webm"></video>\',700)</script>');
    if (url.pathname === '/embedded') return html(`<iframe src="http://localhost:${server.address().port}/plain"></iframe>`);
    if (url.pathname === '/metadata') return html('<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"/sample.webm"}</script>');
    if (url.pathname === '/visible-unavailable') return html('<video width="1280" height="1000" src="/decoy.mp4#t=2"></video><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"/sample.webm"}</script>');
    if (url.pathname === '/visible-gone') return html('<video width="1280" height="1000" src="/gone.mp4"></video><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"/sample.webm"}</script>');
    if (url.pathname === '/redirect-unavailable') return html('<video width="1280" height="1000" src="/redirect-decoy.mp4"></video><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"/sample.webm"}</script>');
    if (url.pathname === '/unavailable-only') return html('<video src="/decoy.mp4"></video>');
    if (url.pathname === '/recovered-source') {
      recoveredAt = Date.now() + 1200;
      return html('<video id="media" src="/recovered.webm"></video><script>setTimeout(()=>media.load(),1200)</script>');
    }
    if (url.pathname === '/hidden-decoy') return html('<video hidden src="/decoy.mp4"></video><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"/sample.webm"}</script>');
    if (url.pathname === '/transparent-decoy') return html('<div style="opacity:0"><video width="1280" height="1000" src="/decoy.mp4"></video></div><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"/sample.webm"}</script>');
    if (url.pathname === '/hidden-only') return html('<video hidden src="/sample.webm"></video>');
    if (url.pathname === '/hidden-delayed') return html('<video hidden src="/decoy.mp4"></video><script>setTimeout(()=>{const data=document.createElement("script");data.type="application/ld+json";data.textContent=JSON.stringify({"@type":"VideoObject",contentUrl:"/sample.webm"});document.body.append(data)},1400)</script>');
    if (url.pathname === '/multiple-visible') return html('<video width="1000" height="1000" src="/decoy.mp4"></video><video width="1280" height="1000" src="/sample.webm"></video>');
    if (url.pathname === '/visibility-changed') return html('<video id="decoy" width="1280" height="1000" src="/decoy.mp4"></video><script>setTimeout(()=>{decoy.hidden=true;const data=document.createElement("script");data.type="application/ld+json";data.textContent=JSON.stringify({"@type":"VideoObject",contentUrl:"/sample.webm"});document.body.append(data)},200)</script>');
    if (url.pathname === '/config') return html(`<script>window.player_config={url:${JSON.stringify(`${origin()}/sample.webm`).replaceAll('/', '\\/')}}</script>`);
    if (url.pathname === '/button') return html('<button class="vjs-big-play-button" onclick="this.outerHTML=\'<video src=/sample.webm></video>\'">播放</button>');
    if (url.pathname === '/protected') return html(`<video src="/guarded?v=${++generation}"></video>`);
    if (url.pathname === '/hls-page') return html('<video><source src="/list.m3u8" type="application/x-mpegURL"></video>');
    if (url.pathname === '/dash-page') return html('<video><source src="/manifest.mpd" type="application/dash+xml"></video>');
    if (url.pathname === '/template-page') return html('<video><source src="/template.mpd" type="application/dash+xml"></video>');
    if (url.pathname === '/redirect-page') return html('<video><source src="/redirect-list.m3u8" type="application/x-mpegURL"></video>');
    if (url.pathname === '/blob-page') return html('<video id="media"></video><script>media.src=URL.createObjectURL(new MediaSource());fetch("/list.m3u8")</script>');
    if (url.pathname === '/empty') return html('<p>暂无视频</p>');
    if (url.pathname === '/gone.mp4' || url.pathname === '/recovered.webm' && Date.now() < recoveredAt) {
      res.writeHead(url.pathname === '/gone.mp4' ? 410 : 404);
      res.end();
      return;
    }
    if (path === '/list.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      return res.end('#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:5\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.1,\nsegment.m4s\n#EXT-X-ENDLIST\n');
    }
    if (url.pathname === '/manifest.mpd') {
      res.writeHead(200, { 'Content-Type': 'application/dash+xml' });
      return res.end(`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4.1S" minBufferTime="PT0.5S"><Period><AdaptationSet mimeType="video/mp4" codecs="${adaptive.codec}" segmentAlignment="true"><Representation id="video" bandwidth="100000" width="320" height="180"><SegmentList timescale="1000" duration="4100"><Initialization sourceURL="init.mp4"/><SegmentURL media="segment.m4s"/></SegmentList></Representation></AdaptationSet></Period></MPD>`);
    }
    if (path === '/template.mpd') {
      res.writeHead(200, { 'Content-Type': 'application/dash+xml' });
      return res.end(`<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4.1S" minBufferTime="PT0.5S"><Period><AdaptationSet mimeType="video/mp4" codecs="${adaptive.codec}" segmentAlignment="true"><SegmentTemplate timescale="1000" duration="4100" startNumber="1" initialization="init.mp4" media="segment-$Number$.m4s"/><Representation id="video" bandwidth="100000" width="320" height="180"/></AdaptationSet></Period></MPD>`);
    }
    if (url.pathname === '/guarded' && (!(req.headers.cookie || '').includes('web_fixture=1')
      || !req.headers.referer?.startsWith(`${origin()}/protected`))) {
      res.writeHead(403);
      return res.end();
    }
    const media = path === '/init.mp4' ? adaptive.init : ['/segment.m4s', '/segment-1.m4s'].includes(path) ? adaptive.segment
      : url.pathname === '/fixture.mp4' ? adaptive.mp4 : ['/sample.webm', '/guarded', '/recovered.webm'].includes(url.pathname) ? webm : undefined;
    if (!media) { res.writeHead(404); res.end(); return; }
    const mime = ['/sample.webm', '/guarded', '/recovered.webm'].includes(url.pathname) ? 'video/webm' : 'video/mp4';
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    res.writeHead(range ? 206 : 200, { 'Content-Type': mime, 'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) });
    res.end(req.method === 'HEAD' ? undefined : media.subarray(start, end + 1));
  });
  const origin = () => `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.listen(0, resolve));
  return { origin: origin(), requests, close: async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}
