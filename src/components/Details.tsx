import { useId, useRef } from 'react';
import { Play, ListPlus, Clock3, Heart, ExternalLink, RefreshCw } from 'lucide-react';
import type { MediaItem, MediaPart } from '../shared/types';
import { useMediaDetails } from '../hooks/useMediaDetails';
import { DetailsSummary } from './DetailsSummary';
import { FavoritePicker } from './FavoritePicker';
import type { CollectionChange } from '../shared/collection-change';

interface Props {
  item: MediaItem;
  play: (item: MediaItem, part?: MediaPart) => void;
  enqueue: (item: MediaItem) => void;
  notify: (text: string) => void;
  opening: boolean;
  queued: boolean;
  queueBusy: boolean;
  isWatchLater?: boolean;
  collectionChanged: (change: CollectionChange) => void;
}

export function Details({ item, play, enqueue, notify, opening, queued, queueBusy, isWatchLater = false, collectionChanged }: Props) {
  const state = useMediaDetails(item, notify, isWatchLater, collectionChanged);
  const { detail, current, selected } = state;
  const partsId = useId();
  const favoriteOpener = useRef<HTMLButtonElement>(null);
  return (
    <div className="detail-content" aria-busy={!detail && !state.error || opening}>
      <DetailsSummary item={current} />
      {detail && (
        <div className="button-row detail-primary-actions">
          <button className="primary" aria-disabled={opening || undefined} data-focus-retain
            onClick={() => { if (!opening) play(current, detail.parts.find(part => part.id === selected)); }}>
            <Play size={18} fill="currentColor" />{opening ? '正在准备…' : '立即播放'}
          </button>
          <button aria-disabled={queued || queueBusy || undefined} data-focus-retain
            onClick={() => { if (!queued && !queueBusy) enqueue(current); }}>
            <ListPlus size={18} />{queued ? '已在队列中' : '加入队列'}
          </button>
        </div>
      )}
      {state.error ? (
        <div className="inline-error" role="alert"><span>{state.error}</span><button onClick={state.reload}>重新加载</button></div>
      ) : !detail ? <p className="loading" role="status"><RefreshCw className="spin" size={18} />正在加载视频信息…</p> : (
        <>
          {detail.parts.length > 1 && (
            <div className="part-picker">
              <label htmlFor={partsId}>选择分集 <span>共 {detail.parts.length} 集</span></label>
              <select id={partsId} value={selected} onChange={event => state.setSelected(event.target.value)}>
                {detail.parts.map((part, index) => <option key={part.id} value={part.id}>第 {index + 1} 集 · {part.title}</option>)}
              </select>
              <div className="part-buttons" role="group" aria-label="分集">
                {detail.parts.map((part, index) => (
                  <button key={part.id} className={selected === part.id ? 'selected' : ''}
                    aria-label={`第 ${index + 1} 集：${part.title}`} aria-pressed={selected === part.id}
                    title={part.title} onClick={() => state.setSelected(part.id)}>第 {index + 1} 集</button>
                ))}
              </div>
            </div>
          )}
          {detail.description && <p className="description" tabIndex={0} aria-label="视频简介" data-scroll-content>{detail.description}</p>}
          {current.source === 'bilibili' && current.kind === 'video' && (
            <div className="button-row detail-actions">
              <button aria-disabled={state.saving || undefined} data-focus-retain onClick={() => void state.watchLater()}>
                <Clock3 size={18} />{state.watchLaterAdded ? '移出稍后再看' : '稍后再看'}
              </button>
              <button ref={favoriteOpener} aria-disabled={state.foldersLoading || state.saving || undefined} data-focus-retain
                aria-expanded={!!state.folders} onClick={() => { if (!state.saving) void state.loadFolders(); }}>
                <Heart size={18} />{state.foldersLoading ? '正在加载…' : '收藏'}
              </button>
            </div>
          )}
        </>
      )}
      {state.folders && <FavoritePicker folders={state.folders} folder={state.folder} saving={state.saving}
        change={state.setFolder} favorite={add => void state.favorite(add)} close={state.closeFolders} opener={favoriteOpener.current} />}
      {current.source === 'bilibili' && <button className="text-button" onClick={() => void state.official()}><ExternalLink size={15} />在 B 站打开</button>}
    </div>
  );
}
