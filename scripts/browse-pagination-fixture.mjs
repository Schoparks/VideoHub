// Synthetic provider responses; installed only in an isolated Electron process.
export function installPaginationFixture({ ipcMain }, boot) {
  const state = globalThis.paginationSmoke = {
    browse: [],
    active: 0,
    maxActive: 0,
    failed: false,
    resolves: [],
    releases: [],
  };
  const replace = (name, handler) => {
    ipcMain.removeHandler(`hub:${name}`);
    ipcMain.handle(`hub:${name}`, async (_event, args) => {
      try {
        return { ok: true, data: await handler(...args) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
  };
  const keyOf = request => {
    const filter = request.kind === 'dynamic' ? request.dynamicType
      : request.kind === 'search' ? request.keyword
        : ['favorites', 'regions', 'cinema', 'followingCinema'].includes(request.kind)
          ? request.id : '';
    const searchType = request.kind === 'search' && request.searchType && request.searchType !== 'all'
      ? `:${request.searchType}` : '';
    return `${request.kind}:${filter}${searchType}`;
  };
  const items = (key, start, length) => Array.from({ length }, (_, offset) => ({
    id: `${key}:${start + offset}`,
    source: 'bilibili',
    kind: 'video',
    title: `分页测试 ${key} · ${start + offset}`,
    author: '分页测试作者',
    aid: 900000 + start + offset,
    cid: 800000 + start + offset,
    duration: 180,
  }));
  replace('bootstrap', () => ({
    ...boot,
    library: [],
    history: [],
    queue: [],
    account: {
      app: true,
      web: true,
      appMid: 'pagination-fixture',
      webMid: 'pagination-fixture',
      name: '分页隔离测试账号',
      storage: 'memory',
    },
    preferences: { ...boot.preferences, autoNext: false },
  }));
  replace('folders', () => [
    { id: 1, title: '收藏夹一', count: 60 },
    { id: 2, title: '收藏夹二', count: 60 },
  ]);
  replace('browse', async request => {
    if (request.kind === 'recommend') return { items: [], hasMore: false };
    const key = keyOf(request);
    state.browse.push({ ...request, key });
    state.active++;
    state.maxActive = Math.max(state.maxActive, state.active);
    try {
      await new Promise(resolve => setTimeout(resolve, 80));
      if (request.keyword === 'error' && request.page === 2 && !state.failed) {
        state.failed = true;
        throw new Error('隔离测试：下一页暂时无法加载');
      }
      const empty = request.keyword === 'empty';
      const duplicate = request.keyword === 'duplicate';
      const loop = request.keyword === 'loop' || (request.kind === 'history' && state.historyLoop);
      const page = request.page || 1;
      const result = {
        items: empty ? [] : duplicate || loop || page === 1
          ? items(key, 1, 40) : items(key, 40, 21),
        hasMore: empty || duplicate || loop || page === 1,
        cursor: `${key}:cursor-${loop ? 1 : page}`,
      };
      if (request.kind === 'search' && ['media_bangumi', 'media_ft'].includes(request.searchType)) {
        result.items = result.items.map(item => ({
          ...item,
          kind: 'season',
          seasonId: item.aid,
          episodeId: item.cid,
        }));
      }
      if (request.kind === 'followingLive' || request.searchType === 'live_room') {
        result.items = result.items.map(item => ({ ...item, kind: 'live', roomId: item.aid, badge: '直播中' }));
      }
      if (request.kind === 'dynamic') {
        result.dynamics = result.items.map(item => ({
          id: `dynamic:${item.id}`,
          author: '动态分页测试作者',
          text: item.title,
          images: [],
          video: request.dynamicType === 'video' ? item : undefined,
          url: 'https://t.bilibili.com/1',
        }));
        result.items = [];
      }
      return result;
    } finally {
      state.active--;
    }
  });
  replace('resolve', async item => {
    state.resolves.push(item);
    if (state.deferResolve) {
      state.deferResolve = false;
      await new Promise(resolve => { state.finishResolve = resolve; });
    }
    return {
      sessionId: `pagination-playback-${state.resolves.length}`,
      item,
      parts: [],
      // No network or decode: only verify season dispatch and player suspension.
      url: 'data:video/webm;base64,',
      format: 'file',
      startAt: 0,
      live: false,
    };
  });
  replace('progress', () => ({ synced: false }));
  replace('release', session => { state.releases.push(session); });
}
