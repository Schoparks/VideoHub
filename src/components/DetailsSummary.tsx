import type { MediaItem } from '../shared/types';
import { time } from '../api';
import { CoverImage } from './CoverImage';

export function DetailsSummary({ item }: { item: MediaItem }) {
  const metadata = [item.author, item.duration ? time(item.duration) : undefined].filter(Boolean).join(' · ');
  return (
    <div className="detail-summary">
      <div className="detail-visual">
        <CoverImage src={item.cover} alt="" />
        <span className="pill">{item.source === 'bilibili' ? 'B 站' : item.source === 'local' ? '本地视频' : '网络视频'}</span>
      </div>
      <div className="detail-heading">
        <h1>{item.title}</h1>
        {metadata && <p className="muted">{metadata}</p>}
      </div>
    </div>
  );
}
