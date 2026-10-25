import { bilibiliResolution, selectBilibiliQuality } from '../src/shared/bilibili-quality.ts';
// Isolated interface fixture; no platform requests or real media decoding.
function install() {
  const state = window.reliability;
  state.failNextBootstrap = false;
  state.available = [120, 116, 112, 80, 64];
  state.preferenceWrites = [];
  Object.assign(state.boot.preferences, {
    bilibiliMaxQuality: 0, bilibiliQualityMode: 'highest', bilibiliRememberedQuality: 0,
  });
  const resolve = window.hub.resolve;
  window.hub.resolve = async (item, part, explicit) => {
    const prefs = state.boot.preferences;
    const ceiling = prefs.bilibiliMaxQuality || 127;
    const target = explicit ?? (prefs.bilibiliQualityMode === 'remember' ? prefs.bilibiliRememberedQuality || 127 : 127);
    const allowed = state.available.filter(id => bilibiliResolution(id) <= bilibiliResolution(ceiling));
    const quality = state.nextActualQuality || selectBilibiliQuality(allowed, target);
    state.nextActualQuality = undefined;
    const result = await resolve(item, part, quality);
    state.resolves.at(-1).explicit = explicit;
    if (state.failResolve) throw new Error('清晰度解析失败');
    const labels = { 120: '4K', 116: '1080P 60帧', 112: '1080P 高码率', 80: '1080P', 64: '720P' };
    return { ...result, qualities: allowed.map(id => ({ id, label: labels[id] })) };
  };
  window.hub.preferences = async preferences => {
    state.preferenceWrites.push(structuredClone(preferences));
    if (state.holdPreferences) await new Promise(resolve => { state.finishPreferences = resolve; });
    if (state.failPreferences) {
      state.failPreferences = false;
      throw new Error('设置保存失败');
    }
    state.boot.preferences = structuredClone(preferences);
  };
}
export const installQualityFixture = new Function(`${bilibiliResolution}; ${selectBilibiliQuality}; (${install})();`);
