import { FileVideo, Play, Radio, Film, MoreHorizontal } from 'lucide-react';
import type { HistoryEntry, MediaItem } from '../shared/types';
import { time } from '../api';
import { CoverImage } from './CoverImage';
import { resumePosition } from '../shared/playback-progress';

interface CardProps {
  item: MediaItem;
  open: () => void;
  history?: HistoryEntry;
  details?: () => void;
}

export function Card({ item, open, history, details }: CardProps) {
  const author = item.author || (item.source === 'url' ? '网络视频' : '视频');
  const meta = history ? resumePosition(history) > 0 ? '继续观看' : '从头播放'
    : item.kind !== 'live' ? item.badge : '';
  const duration = history?.duration || item.duration;
  const durationLabel = item.kind === 'live'
    ? item.badge
    : history ? `${time(history.position)}${duration ? ` / ${time(duration)}` : ''}`
    : duration ? time(duration) : '';

  return (
    <div className="media-card-wrap">
      <button
        className="media-card"
        onClick={open}
        data-media-id={item.id}
        data-focus-key={`${item.id}:${history?.part?.id || ''}:play`}
        aria-label={`播放 ${item.title}`}
        title={item.title}
      >
        <div className={`cover ${item.source}`}>
          {item.cover ? (
            <CoverImage src={item.cover} alt="" loading="lazy" />
          ) : (
            <div className="cover-placeholder" aria-hidden="true">
              {item.kind === 'live' ? <Radio /> : item.kind === 'season' ? <Film /> : <FileVideo />}
            </div>
          )}
          <span className={`source-badge ${item.kind === 'live' ? 'live' : ''}`}>
            {item.kind === 'live' ? '● 直播' : item.source === 'bilibili' ? 'bilibili' : item.source === 'local' ? '本地' : 'URL'}
          </span>
          {durationLabel && <span className="duration">{durationLabel}</span>}
          <span className="play-indicator" aria-hidden="true">
            <Play size={23} fill="currentColor" />
          </span>
          {history && history.duration > 0 && (
            <div className="card-progress">
              <i style={{ width: `${Math.min(100, history.position / history.duration * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="card-copy">
          <h3>{item.title}</h3>
          {history?.part && (
            <small className="card-episode" title={history.part.title}>
              {history.part.title}
            </small>
          )}
          <p>
            <span className="card-author" title={author}>{author}</span>
            {meta && <span className="card-meta" title={meta}>{meta}</span>}
          </p>
        </div>
      </button>
      {details && (
        <button
          className="card-details"
          data-gamepad-skip
          aria-label={`详情 ${item.title}`}
          data-media-id={item.id}
          title="视频详情"
          onClick={details}
        >
          <MoreHorizontal size={19} />
        </button>
      )}
    </div>
  );
}
