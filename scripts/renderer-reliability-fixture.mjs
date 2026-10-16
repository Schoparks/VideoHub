// Runs only in a headless test page. Media events are simulated, not decoding evidence.
export function installReliabilityFixture() {
  const item = { id: 'bili:reliability', source: 'bilibili', kind: 'video', title: '可靠性测试', aid: 42 };
  const parts = [1, 2].map(id => ({ id: `cid:${id}`, cid: id, title: `测试第 ${id} 集` }));
  const state = window.reliability = {
    bootstrapCalls: 0, resolves: [], releases: [], progress: [], pendingProgress: [],
    failNextBootstrap: true, holdBootstrap: false, holdResolve: false, holdDetail: false,
    holdProgress: false, failRelease: false, omitParts: false,
    foldersMode: 'empty', foldersCalls: 0, browse: [],
    danmakuCalls: 0, danmakuMode: 'normal',
    boot: {
      account: { app: true, web: true, appMid: 'fixture', webMid: 'fixture', storage: 'memory' },
      library: [], history: [], queue: [item, { ...item, id: 'bili:other', title: '另一项' }],
      preferences: {
        tvMode: false, volume: .8, syncHistory: false, autoNext: false, theme: 'light', deadzone: .28,
        playbackRate: 1, danmaku: false, danmakuOpacity: .8, danmakuFontSize: 25, danmakuArea: .5,
        gamepadMap: { confirm: 0, back: 1, details: 2, search: 3, previous: 4, next: 5, rewind: 6, forward: 7, pause: 9 },
      },
      platform: 'test', version: 'fixture',
    },
  };
  const copy = value => structuredClone(value);
  const suspendListeners = new Set();
  state.suspend = () => { for (const listener of suspendListeners) listener(); };
  window.hub = {
    onSuspend: listener => {
      suspendListeners.add(listener);
      return () => suspendListeners.delete(listener);
    },
    bootstrap: async () => {
      state.bootstrapCalls++;
      if (state.failNextBootstrap) {
        state.failNextBootstrap = false;
        throw new Error('初始化读取失败');
      }
      const result = copy(state.boot);
      if (state.holdBootstrap) await new Promise(resolve => { state.finishBootstrap = resolve; });
      return result;
    },
    browse: async request => { state.browse.push(copy(request)); return { items: [copy(item)], hasMore: false }; },
    detail: async input => {
      if (state.holdDetail) await new Promise(resolve => { state.finishDetail = resolve; });
      return state.detailOverride || { item: input, parts: copy(parts), description: '' };
    },
    folders: async () => {
      state.foldersCalls++;
      if (state.foldersMode === 'loading') await new Promise(resolve => { state.finishFolders = resolve; });
      if (state.foldersMode === 'error') throw new Error('收藏夹读取失败');
      return state.foldersMode === 'empty' ? [] : [{ id: 1, title: '测试收藏夹', count: 1 }];
    },
    resolve: async (input, part, quality = 80) => {
      part ||= state.partsOverride?.[0] || parts[0];
      const sessionId = crypto.randomUUID();
      state.resolves.push({ sessionId, part: part.id, quality });
      if (state.holdResolve) await new Promise(resolve => { state.finishResolve = resolve; });
      return {
        sessionId, item: state.itemOverride || input, part,
        parts: state.omitParts ? undefined : copy(state.partsOverride || parts), quality,
        qualities: [{ id: 80, label: '1080P' }, { id: 64, label: '720P' }],
        url: 'http://fixture.invalid/media', format: 'file', startAt: 0, live: false,
      };
    },
    release: async sessionId => {
      state.releases.push(sessionId);
      if (state.failRelease) throw new Error('退出保存失败');
    },
    progress: async (sessionId, position) => {
      state.progress.push({ sessionId, position });
      if (state.holdProgress) await new Promise(resolve => { state.pendingProgress.push(resolve); });
      return { synced: false };
    },
    danmaku: async () => {
      state.danmakuCalls++;
      if (state.danmakuMode === 'loading') await new Promise(resolve => { state.finishDanmaku = resolve; });
      if (state.danmakuMode === 'error') throw new Error('fixture danmaku failure');
      return [{ id: 'fixed', time: 1, mode: 5, text: '同步弹幕', color: '#ffffff' },
        { id: 'scroll', time: 1, mode: 1, text: '<img>安全文本', color: '#ffffff' }];
    },
    queue: async items => { state.boot.queue = copy(items); },
    preferences: async preferences => { state.boot.preferences = copy(preferences); },
    fullscreen: async () => {},
    cancelLogin: async () => {},
  };

  const mediaState = new WeakMap();
  const media = element => {
    if (!mediaState.has(element)) mediaState.set(element, { paused: true, position: 0, src: '' });
    return mediaState.get(element);
  };
  Object.defineProperties(HTMLMediaElement.prototype, {
    readyState: { configurable: true, get() { return media(this).src ? 4 : 0; } },
    duration: { configurable: true, get() { return 120; } },
    paused: { configurable: true, get() { return media(this).paused; } },
    currentTime: {
      configurable: true,
      get() { return media(this).position; },
      set(value) { media(this).position = value; this.dispatchEvent(new Event('timeupdate')); },
    },
    src: {
      configurable: true,
      get() { return media(this).src; },
      set(value) {
        media(this).src = value;
        setTimeout(() => { if (this.isConnected) this.dispatchEvent(new Event('loadedmetadata')); }, 0);
      },
    },
  });
  HTMLMediaElement.prototype.play = function () {
    media(this).paused = false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function () {
    if (media(this).paused) return;
    media(this).paused = true;
    this.dispatchEvent(new Event('pause'));
  };
  HTMLMediaElement.prototype.load = function () { media(this).src = ''; };
}
