import type { Action } from './gamepad';

const actions = new Set<Action>(['up', 'down', 'left', 'right', 'confirm', 'menu', 'back']);

export function remoteAction(value: unknown): Action | undefined {
  return typeof value === 'string' && actions.has(value as Action) ? value as Action : undefined;
}

export function remoteHints(scope: ParentNode, player: HTMLElement | null, focused: HTMLElement): [string, string][] {
  const entries: [string, string][] = [['方向键', '移动']];
  const seeking = scope === player && player?.dataset.seeking === 'true';
  const range = focused instanceof HTMLInputElement && focused.type === 'range';
  if (seeking || range) entries[0] = ['← →', seeking || focused.classList.contains('timeline') ? '预览 10 秒' : '调整'];
  if (seeking) return [...entries, ['中键', '确认跳转'], ['返回', '取消跳转']];
  if (range) entries.push(['↑ ↓', '移动']);
  else if (focused?.hasAttribute('data-scroll-content')) entries.push(['↑ ↓', '滚动内容']);
  else if (focused?.getAttribute('aria-disabled') !== 'true') {
    const label = focused?.matches('.media-card, .queue-title, .episode-option') ? '播放'
      : focused instanceof HTMLInputElement && !['checkbox', 'radio'].includes(focused.type) ? '屏幕键盘'
        : focused instanceof HTMLSelectElement ? '下一项' : '确认';
    entries.push(['中键', label]);
  }
  if (scope === document) {
    entries.push(['菜单', focused?.closest('.media-card-wrap') ? '视频详情' : '设置']);
    entries.push(['返回', focused?.closest('.topbar') ? '返回首页 / 退出' : '返回上级栏']);
  } else {
    entries.push(['返回', scope === player ? '隐藏控件 / 退出播放' : '取消 / 关闭']);
    if (scope === player) entries.push(['菜单', '播放操作']);
  }
  return entries;
}
