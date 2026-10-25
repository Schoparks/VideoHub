import type { CompanionCommand } from './companion';
import type { companionReply } from './companion-schema';
import { parseCompanionCommand } from './companion-command';
import type { z } from 'zod';
/** Finite phone contract: presentation data only, never credentials or media addresses. */
export const controllerActions = [
  'up', 'down', 'left', 'right', 'confirm', 'back', 'menu', 'details',
  'search', 'previous', 'next', 'rewind', 'forward', 'pause',
] as const;
export type ControllerAction = typeof controllerActions[number];
export type ControllerCommand =
  | { kind: 'action'; action: ControllerAction }
  | { kind: 'search'; text: string }
  | { kind: 'url'; text: string }
  | CompanionCommand;
export type ControllerError = 'busy' | 'blocked' | 'failed' | 'unavailable' | 'canceled' | 'app-auth' | 'web-auth';
export type ControllerReply = z.infer<typeof companionReply>;
export interface ControllerRequest { id: string; command: ControllerCommand }
export interface ControllerStatus { enabled: boolean; urls: string[] }

export const controllerLabels: Record<ControllerAction, string> = {
  up: '上', down: '下', left: '左', right: '右', confirm: '确认', back: '返回',
  menu: '菜单', details: '详情 / 选集', search: '搜索', previous: '上一项 / 上一栏',
  next: '下一项 / 下一栏', rewind: '后退 / 上翻页', forward: '快进 / 下翻页', pause: '播放 / 暂停',
};

export function isControllerAction(value: unknown): value is ControllerAction {
  return typeof value === 'string' && controllerActions.includes(value as ControllerAction);
}

export function parseControllerCommand(value: unknown): ControllerCommand | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Record<string, unknown>;
  const companion = parseCompanionCommand(input);
  if (companion) return companion;
  if (input.kind === 'action' && isControllerAction(input.action)) return { kind: 'action', action: input.action };
  if (typeof input.text !== 'string' || !input.text.trim()) return;
  const text = input.text.trim();
  if (input.kind === 'search' && text.length <= 200) return { kind: 'search', text };
  if (input.kind === 'url' && text.length <= 10000 && (/^BV[\da-zA-Z]{10}$/i.test(text) || validUrl(text))) {
    return { kind: 'url', text };
  }
}

function validUrl(text: string) {
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
