// Serialized into an isolated Electron main process; no real account or provider calls.
export function installInteractionFixture({ ipcMain }, fixture) {
  const state = globalThis.interactionSmoke = {
    failBootstrap: true, failQueue: true, failPreferences: true, prefs: [], concurrency: 0, maximum: 0,
    cancelled: [], detailCalls: 0, boot: fixture.boot,
  };
  const replace = (name, handler) => {
    ipcMain.removeHandler(`hub:${name}`);
    ipcMain.handle(`hub:${name}`, async (_event, args) => {
      try { return { ok: true, data: await handler(...args) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
  };
  replace('bootstrap', () => {
    if (state.failBootstrap) { state.failBootstrap = false; throw new Error('初始化读取失败'); }
    return state.boot;
  });
  replace('preferences', async value => {
    state.concurrency++; state.maximum = Math.max(state.maximum, state.concurrency); state.prefs.push(value);
    try {
      await new Promise(resolve => setTimeout(resolve, 80));
      if (state.failPreferences) { state.failPreferences = false; throw new Error('设置保存失败'); }
      state.boot.preferences = value;
    } finally { state.concurrency--; }
  });
  replace('queue', async items => {
    await new Promise(resolve => setTimeout(resolve, 80));
    if (state.failQueue) throw new Error('队列保存失败');
    state.boot.queue = items;
  });
  replace('detail', async item => {
    state.detailCalls++;
    return {
      item, description: '长简介的完整内容。\n'.repeat(100),
      parts: [1, 2, 3].map(index => ({ id: `fixture-part-${index}`, title: `测试分集 ${index}`, cid: index })),
    };
  });
  replace('folders', () => [{ id: 1, title: '收藏夹名称'.repeat(25), count: 10 }, { id: 2, title: '其他收藏夹', count: 1 }]);
  replace('favorite', () => {});
  replace('login', () => new Promise(resolve => { state.finishLogin = resolve; }));
  replace('cancelLogin', id => { state.cancelled.push(id); });
  replace('pollLogin', () => ({ state: 'waiting' }));
}
