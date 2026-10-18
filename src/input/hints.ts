import type { Preferences } from '../shared/types';
import type { Action } from './gamepad';
import { activeFocusScope } from './focus';
import { actionKey } from './bindings';
import { remoteHints } from './remote';

function confirmLabel(element: HTMLElement, mode: string) {
  if (element.closest('.settings') && element.matches('select, input[type="range"]')) {
    return element.dataset.settingEditing ? '完成编辑' : '编辑';
  }
  if (element.dataset.confirmLabel) return element.dataset.confirmLabel;
  if (element.getAttribute('aria-haspopup') === 'dialog') return '选择';
  if (element instanceof HTMLSelectElement && mode === 'gamepad') return '下一项';
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement && !['range', 'checkbox', 'radio'].includes(element.type)) {
    return mode === 'gamepad' ? '屏幕键盘' : '确认';
  }
  if (element.matches('.media-card, .queue-title, .episode-option')) return '播放';
  const state = element.dataset.stateLabel || (element.matches('[role="switch"]')
    ? element.getAttribute('aria-checked') === 'true' || element instanceof HTMLInputElement && element.checked ? '已开启' : '已关闭'
    : '');
  if (state) return `切换 · ${state}`;
  return '确认';
}

export function createInputHint() {
  const hint = document.createElement('div');
  hint.className = 'controller-focus-hint';
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  let previous = '';
  return {
    update(preferences: Preferences, standard = true) {
      const mode = document.documentElement.dataset.inputMode || 'keyboard';
      const scope = activeFocusScope();
      const player = document.querySelector<HTMLElement>('.player');
      const hiddenPlayer = scope === player && !player?.classList.contains('controls-visible');
      const exiting = player?.dataset.exiting === 'true' && (scope === player || scope instanceof HTMLElement && player.contains(scope));
      const host = scope.querySelector('[data-input-hints-host]');
      if (host && hint.parentElement !== host) host.append(hint);
      hint.hidden = mode === 'pointer' || !document.hasFocus() || hiddenPlayer || exiting || !host;
      if (hint.hidden) return;
      const focused = document.activeElement as HTMLElement;
      const keyboard = scope.querySelector<HTMLElement>('[data-screen-keyboard]');
      const entries: [string, string][] = [];
      const key = (action: Action) => actionKey(action, preferences.gamepadMap, mode, standard);
      const add = (action: Action, label: string) => entries.push([key(action), label]);
      if (mode === 'remote') {
        entries.push(...remoteHints(scope, player, focused));
      } else if (document.querySelector('[data-calibrating="true"]')) {
        entries.push(['短按', '目标键录入']);
        entries.push([`长按 ${key('back')}`, '取消'], ['Esc', '取消']);
      } else if (focused?.closest('.settings') && focused.matches('select, input[type="range"]')) {
        entries.push(['↑ ↓', '移动']);
        if (focused.dataset.settingEditing) entries.push(['← →', '调整']);
        add('confirm', confirmLabel(focused, mode));
        add('back', focused.dataset.settingEditing ? '结束编辑' : '关闭');
      } else if (player?.dataset.seeking === 'true' && scope === player) {
        entries.push(['← →', '调整 10 秒']);
        add('confirm', '确认跳转');
        add('back', '取消跳转');
      } else {
        const select = focused instanceof HTMLSelectElement;
        const range = focused instanceof HTMLInputElement && focused.type === 'range';
        if (range && focused.getAttribute('aria-disabled') === 'true') entries.push(['↑ ↓', '移动']);
        else if (select && mode !== 'gamepad') entries.push(['↑ ↓', '选择'], ['Tab', '移动']);
        else {
          const timeline = range && focused.classList.contains('timeline');
          entries.push([select || range ? '← →' : '方向键', timeline ? '预览 10 秒' : select || range ? '调整' : '移动']);
          if (select || range) entries.push(['↑ ↓', '移动']);
        }
        const readonly = focused?.matches('article, [data-scroll-content]');
        if (focused?.hasAttribute('data-scroll-content')) entries.push(['↑ ↓', focused.dataset.scrollLabel || '滚动内容']);
        if (!range && !readonly && focused?.getAttribute('aria-disabled') !== 'true') add('confirm', confirmLabel(focused, mode));
        if (scope !== document) {
          const backLabel = scope instanceof HTMLElement ? scope.dataset.backLabel : undefined;
          add('back', keyboard?.dataset.composing === 'true' ? '取消拼音'
            : scope.querySelector('[data-back-action]')?.getAttribute('aria-label') || backLabel
              || (player && scope === player ? '隐藏控件' : '关闭'));
        }
        else if (!focused?.closest('.topbar')) add('back', '返回上级栏');
        if (scope === document) {
          if (focused?.closest('.media-card-wrap')?.querySelector('.card-details')) add('details', '详情');
          add('search', '搜索');
          entries.push([`${key('previous')} / ${key('next')}`, '逐级切栏']);
          const main = focused?.closest('main');
          if (main && main.scrollHeight > main.clientHeight + 1) {
            add('rewind', '向上翻页');
            add('forward', '向下翻页');
          }
        } else if (keyboard && mode === 'gamepad') {
          add('details', '退格');
          add('search', keyboard.dataset.submitLabel || '完成');
          add('previous', '中/英');
          add('next', '数字/符号');
          add('rewind', '清空');
        } else if (scope === player && player?.dataset.switching !== 'true') {
          add('pause', player?.dataset.ended === 'true' ? '重新播放' : player?.dataset.paused === 'true' ? '继续播放' : '暂停');
          if (player?.dataset.live !== 'true') entries.push([`${key('rewind')} / ${key('forward')}`, '跳转 30 秒']);
          add('details', player?.dataset.multipart === 'true' ? '选集' : '播放设置');
          add('search', '队列');
          for (const action of ['previous', 'next'] as const) {
            const control = player.querySelector<HTMLButtonElement>(`[data-player-action="${action}"]`);
            if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true'
              || control.closest('[inert], [hidden], [aria-hidden="true"]')) continue;
            const label = control.getAttribute('aria-label');
            if (label) add(action, label);
          }
        }
      }
      const signature = JSON.stringify(entries);
      if (signature === previous) return;
      previous = signature;
      const actions = document.createElement('div');
      actions.className = 'controller-actions';
      for (const [button, action] of entries) {
        const entry = document.createElement('span');
        const kbd = document.createElement('kbd');
        kbd.textContent = button;
        entry.append(kbd, ` ${action}`);
        actions.append(entry);
      }
      hint.replaceChildren(actions);
    },
    remove: () => hint.remove(),
  };
}
