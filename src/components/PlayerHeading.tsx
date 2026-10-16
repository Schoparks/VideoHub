import { ArrowLeft } from 'lucide-react';
import type { MediaPart, PlaybackSource } from '../shared/types';

interface Props {
  source: PlaybackSource;
  parts: MediaPart[];
  partIndex: number;
  paused: boolean;
  ended: boolean;
  loading: boolean;
  switching: boolean;
  exiting: boolean;
  leave: () => void;
}

export function PlayerHeading({ source, parts, partIndex, paused, ended, loading, switching, exiting, leave }: Props) {
  return (
    <header>
      <button className="icon-button" aria-label="退出播放" onClick={leave} data-player-leave
        aria-busy={exiting || undefined} aria-disabled={exiting || undefined} data-focus-retain={exiting || undefined}><ArrowLeft /></button>
      <div>
        <h2 title={source.item.title}>{source.item.title}</h2>
        <p title={source.part?.title || source.item.author}>
          {parts.length > 1 && partIndex >= 0 ? `第 ${partIndex + 1} 集 / 共 ${parts.length} 集 · ` : ''}
          {source.part?.title || source.item.author}
          <span> / {source.item.source === 'bilibili' ? 'B 站' : source.item.source === 'local' ? '本地视频' : '网络视频'}</span>
        </p>
      </div>
      <span className="playing-badge">
        {exiting ? '正在退出' : switching ? '正在切换' : ended ? '已播完' : loading ? '正在缓冲' : paused ? '已暂停' : source.live ? '直播中' : '正在播放'}
      </span>
    </header>
  );
}
