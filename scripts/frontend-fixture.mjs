// All content is synthetic and exists only inside an isolated smoke-test process.
export const longTitle = '长标题边界：从城市走向山野的一次旅行记录' + '无空格连续内容'.repeat(18);
export const longAuthor = '超长作者名称' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(5);

export function frontendFixture(boot) {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `bili:frontend-${index}`,
    source: 'bilibili',
    kind: 'video',
    title: index === 0 ? longTitle : `山野纪行 · 第 ${index + 1} 集`,
    author: index === 0 ? longAuthor : '山野记录',
    aid: 990000 + index,
    cid: 800000 + index,
    cover: `https://fixture.example/cover-${index}.svg`,
    duration: index === 0 ? 360000 : 190 + index * 43,
    badge: index === 0 ? '9999999999999 次观看' : undefined,
  }));
  const dynamics = [
    {
      id: 'frontend-dynamic-video',
      author: longAuthor,
      avatar: 'https://fixture.example/avatar.svg',
      text: longTitle,
      images: [],
      video: items[0],
      publishedAt: 1790400000000,
      url: 'https://t.bilibili.com/1',
    },
    {
      id: 'frontend-dynamic-text',
      author: '文字与配图',
      text: '保留原始动态的段落。\n' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12),
      images: ['https://fixture.example/picture.svg'],
      publishedAt: 1790396400000,
      url: 'https://t.bilibili.com/2',
    },
  ];
  return {
    boot: {
      ...boot,
      account: {
        app: true,
        web: true,
        appMid: 'frontend-fixture',
        webMid: 'frontend-fixture',
        name: longAuthor,
        storage: 'memory',
      },
      library: [],
      history: [],
      queue: [items[0], items[1]],
    },
    items,
    dynamics,
  };
}

// This function is serialized by Playwright and runs in Electron's main process.
export function installFrontendFixture({ ipcMain }, fixture) {
  const state = globalThis.frontendSmoke = {
    mode: 'normal',
    browse: [],
    preferences: [],
    fullscreen: [],
    boot: fixture.boot,
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
  replace('bootstrap', () => state.boot);
  replace('browse', async request => {
    state.browse.push(request);
    if (state.mode === 'loading') {
      await new Promise(resolve => { state.finishLoading = resolve; });
    }
    if (state.mode === 'error') throw new Error('隔离测试：内容暂时无法加载');
    if (state.mode === 'empty') return { items: [], hasMore: false };
    if (request.kind === 'dynamic') {
      return {
        items: [],
        dynamics: request.dynamicType === 'video' ? [fixture.dynamics[0]] : fixture.dynamics,
        hasMore: false,
      };
    }
    return { items: fixture.items, hasMore: false };
  });
  replace('folders', () => [{ id: 1, title: '收藏夹', count: 12 }]);
  replace('preferences', value => {
    state.preferences.push(value);
    state.boot.preferences = value;
  });
  replace('fullscreen', value => { state.fullscreen.push(value); });
  replace('queue', items => { state.boot.queue = items; });
}

export async function installFrontendImages(page) {
  await page.route('https://fixture.example/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540">
      <rect width="960" height="540" fill="#a8c6b8"/>
      <circle cx="735" cy="130" r="68" fill="#efe1ad"/>
      <path d="M0 440L200 180 400 370 600 200 960 440V540H0Z" fill="#406958"/>
      <path d="M0 500L230 345 380 450 650 300 960 475V540H0Z" fill="#244438"/>
    </svg>`,
  }));
}
