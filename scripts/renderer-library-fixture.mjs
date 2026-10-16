/** Installed only on a headless page, after the base reliability fixture. */
export function installLibraryFixture() {
  const copy = value => structuredClone(value);
  const original = { id: 'local:old', source: 'local', kind: 'video', title: '已有影片', path: '/fixture/old.mp4' };
  const added = { id: 'local:new', source: 'local', kind: 'video', title: '新导入影片', path: '/fixture/new.mp4' };
  window.reliability.boot.library = [original];
  const state = window.libraryTest = { mode: 'cancel', hold: false, requests: [], running: 0, maximum: 0 };
  const operation = async (kind, directory) => {
    state.requests.push({ kind, directory });
    state.running++;
    state.maximum = Math.max(state.maximum, state.running);
    try {
      if (state.hold) await new Promise(resolve => { state.finish = resolve; });
      if (state.mode === 'error') throw new Error('目录暂时不可读取');
      if (kind === 'add' && state.mode === 'cancel') {
        return { library: [], canceled: true, found: 0, added: 0 };
      }
      if (state.mode === 'empty') return kind === 'add'
        ? { library: copy(window.reliability.boot.library), canceled: false, found: 0, added: 0 }
        : copy(window.reliability.boot.library);
      const existing = window.reliability.boot.library;
      const isNew = !existing.some(item => item.id === added.id);
      if (isNew) window.reliability.boot.library = [...existing, added];
      return kind === 'add'
        ? { library: copy(window.reliability.boot.library), canceled: false, found: 1, added: isNew ? 1 : 0 }
        : copy(window.reliability.boot.library);
    } finally { state.running--; }
  };
  window.hub.addLocal = directory => operation('add', directory);
  window.hub.rescan = () => operation('rescan');
}
