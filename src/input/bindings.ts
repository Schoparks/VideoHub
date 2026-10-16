import type { Action } from './gamepad';

export const actionLabels: Partial<Record<Action, string>> = {
  confirm: '确认', back: '返回', details: '详情 / 选集', search: '搜索 / 队列',
  previous: '上一栏目 / 上一集', next: '下一栏目 / 下一集',
  rewind: '后退 30 秒', forward: '前进 30 秒', pause: '播放 / 暂停',
};

const standardButtons = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS'];
const keyboardKeys: Partial<Record<Action, string>> = {
  confirm: 'Enter', back: 'Esc', details: 'X', search: 'Y',
  previous: 'PgUp', next: 'PgDn', rewind: '[', forward: ']', pause: '空格',
};

export function buttonLabel(index: number | undefined, standard = true) {
  if (index === undefined) return '未绑定';
  return standard && standardButtons[index] || `按键 ${index}`;
}

export function actionKey(action: Action, map: Record<string, number>, mode: string, standard = true) {
  return mode === 'gamepad' ? buttonLabel(map[action], standard) : keyboardKeys[action] || '方向键';
}

/** Swapping keeps every action reachable; D-pad is reserved for navigation. */
export function bindButton(map: Record<string, number>, action: string, index: number) {
  if (index >= 12 && index <= 15) return undefined;
  const next = { ...map };
  for (const key of Object.keys(next)) {
    if (key !== action && next[key] === index) next[key] = map[action];
  }
  next[action] = index;
  return next;
}
