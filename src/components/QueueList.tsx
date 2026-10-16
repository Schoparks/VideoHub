import { ArrowDown, ArrowUp, ListVideo, Play, X } from 'lucide-react';
import type { MediaItem } from '../shared/types';
import { EmptyState } from './EmptyState';

interface Props {
  items: MediaItem[];
  busy: boolean;
  play: (item: MediaItem) => void;
  update: (items: MediaItem[]) => void;
}

export function QueueList({ items, busy, play, update }: Props) {
  const move = (index: number, step: number) => {
    if (busy) return;
    const next = [...items];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    update(next);
  };
  if (!items.length) {
    return <EmptyState icon={ListVideo} title="播放队列为空" description="可在视频详情中加入队列。" />;
  }
  return (
    <div className="queue-list" aria-busy={busy}>
      {items.map((item, index) => (
        <div key={item.id} className="queue-row">
          <span className="queue-number">{String(index + 1).padStart(2, '0')}</span>
          <button className="queue-title" aria-label={`播放 ${item.title}`} onClick={() => play(item)} title={item.title}
            data-focus-key={`queue:${item.id}:play`}>
            <Play size={16} />
            <span>
              <b>{item.title}</b>
              <small>{item.source === 'bilibili' ? 'bilibili' : item.source === 'local' ? '本地视频' : '网络视频'}</small>
            </span>
          </button>
          <div className="queue-actions" role="group" aria-label={`队列操作 ${item.title}`}>
            <button className="icon-button" aria-label={`上移 ${item.title}`} disabled={index === 0}
              aria-disabled={busy || undefined} data-focus-retain={busy || undefined} onClick={() => move(index, -1)}>
              <ArrowUp size={16} />
            </button>
            <button className="icon-button" aria-label={`下移 ${item.title}`} disabled={index === items.length - 1}
              aria-disabled={busy || undefined} data-focus-retain={busy || undefined} onClick={() => move(index, 1)}>
              <ArrowDown size={16} />
            </button>
            <button className="icon-button danger" aria-label={`移除 ${item.title}`}
              aria-disabled={busy || undefined} data-focus-retain={busy || undefined}
              onClick={() => { if (!busy) update(items.filter(entry => entry.id !== item.id)); }}>
              <X size={17} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
