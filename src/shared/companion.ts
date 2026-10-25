export type { CompanionCommand, CompanionCard, CompanionDynamic, CompanionPlayer, CompanionState, CompanionSettings, PlayerCommand } from './companion-schema';
import type { CompanionSettings } from './companion-schema';
import type { Preferences } from './types';
import { restoreBilibiliQuality } from './bilibili-quality';

/** Explicit presentation projection: no gamepad bindings, legacy fields or platform state. */
export function phonePreferences(value: Preferences): CompanionSettings {
  return {
    tvMode: value.tvMode, theme: value.theme, cardColumns: value.cardColumns as CompanionSettings['cardColumns'],
    playbackRate: value.playbackRate, autoNext: value.autoNext, syncHistory: value.syncHistory,
    danmaku: value.danmaku, danmakuOpacity: value.danmakuOpacity,
    danmakuFontSize: value.danmakuFontSize, danmakuArea: value.danmakuArea as CompanionSettings['danmakuArea'],
    bilibiliMaxQuality: restoreBilibiliQuality(value).bilibiliMaxQuality as CompanionSettings['bilibiliMaxQuality'], bilibiliQualityMode: value.bilibiliQualityMode,
  };
}
