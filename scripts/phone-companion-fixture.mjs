import { installReliabilityFixture } from './renderer-reliability-fixture.mjs';

export const installPhoneCompanion = new Function(`(${installReliabilityFixture})();
  window.reliability.failNextBootstrap = false;
  window.reliability.foldersMode = 'ready';
  window.reliability.collectionWrites = [];
  window.reliability.logins = [];
  window.hub.login = async type => {
    window.reliability.logins.push(type);
    return { id: crypto.randomUUID(), type, image: 'data:image/png;base64,AA==', expiresAt: Date.now() + 180000 };
  };
  window.hub.pollLogin = async () => ({ state: 'waiting' });
  window.hub.favorite = async (item, folder, add) => {
    if (window.reliability.failCollection) throw new Error('测试收藏失败');
    window.reliability.collectionWrites.push({ kind: 'favorites', id: item.id, folder, add });
  };
  window.hub.watchLater = async (item, add) => {
    if (window.reliability.failCollection) throw new Error('测试收藏失败');
    window.reliability.collectionWrites.push({ kind: 'watchlater', id: item.id, add });
  };
  const queue = window.hub.queue;
  window.hub.queue = async items => {
    if (window.reliability.failQueue) throw new Error('测试队列保存失败');
    return queue(items);
  };
  Object.assign(window.reliability.boot.preferences, {
    cardColumns: 0, bilibiliMaxQuality: 0, bilibiliQualityMode: 'highest', bilibiliRememberedQuality: 0,
  });
  window.hub.onControllerCommand = callback => { window.receiveController = callback; return () => {}; };
  window.hub.controllerReply = (id, reply) => window.phoneReply(id, reply);
  window.hub.controllerStatus = () => window.phoneStatus();
  window.hub.controllerEnable = () => window.phoneStatus();
  const baseBrowse = window.hub.browse;
  window.hub.browse = async request => {
    const data = await baseBrowse(request);
    if (request.kind === 'dynamic') return { items: [], hasMore: false, dynamics: [{
      id: 'dynamic:fixture', author: '动态作者', text: '手机动态完整正文', images: ['https://i0.hdslb.com/bfs/archive/dynamic.jpg'], url: 'https://t.bilibili.com/fixture',
      original: { id: 'original:fixture', author: '原作者', text: '转发正文', images: [], url: 'https://t.bilibili.com/original', video: data.items[0] },
    }] };
    return { ...data, items: data.items.map(item => ({ ...item,
      title: request.kind === 'search' ? '手机搜索结果：' + request.keyword : request.kind === 'history' ? 'B站历史测试' : '可靠性测试',
      cover: 'https://i0.hdslb.com/bfs/archive/fixture.jpg', author: '隔离作者',
    })) };
  };
  window.reliability.boot.library = [{ id: 'local:fixture', source: 'local', kind: 'video',
    title: '本地样片', path: '/private/fixture.mp4' }];
  window.hub.related = async item => ({ items: [{ ...item, id: 'related:fixture', title: '相关视频测试' }], hasMore: false });
  const save = window.hub.preferences;
  window.hub.preferences = async value => {
    if (window.reliability.failPreference) throw new Error('测试保存失败');
    return save(value);
  };
  const resolve = window.hub.resolve;
  window.hub.resolve = async (...args) => {
    if (window.reliability.failResolve) throw new Error('测试播放解析失败');
    return resolve(...args);
  };
  window.hub.openUrl = async url => {
    if (url.includes('failure')) throw new Error('测试解析失败');
    return { id: 'url:fixture', url, source: 'url', kind: 'video', title: '手机链接' };
  };
  const fetchOriginal = window.fetch;
  window.fetch = async (...args) => String(args[0]).startsWith('yingji://app/image?')
    ? new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } })
    : fetchOriginal(...args);
`);
