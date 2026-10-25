import type { CompanionCard } from '../shared/companion';
import { Ellipsis } from 'lucide-react';
import { usePhoneMediaActions, type MediaActionTarget } from './PhoneMediaActions';
import { PhoneCover } from './PhoneCover';

export function PhoneMediaList({ items, busy, play, context }: {
  items: CompanionCard[]; busy: boolean; play: (item: CompanionCard) => void;
  context?: Omit<MediaActionTarget, 'item'>;
}) {
  const actions = usePhoneMediaActions();
  return <div className="phone-media-grid">{items.map(item => <article className="phone-media-wrap" key={item.handle}>
    <button type="button" className="phone-media" disabled={busy} onClick={() => play(item)} aria-label={`播放 ${item.title}`}>
    <PhoneCover item={item} />
    <span className="phone-media-title">{item.title}</span>
    {item.author && <span className="phone-author">{item.author}</span>}
    </button>
    <button className="phone-media-more" disabled={busy} aria-label={`视频操作 ${item.title}`}
      onClick={event => actions({ item, ...context }, event.currentTarget)}><Ellipsis size={20} /></button>
  </article>)}</div>;
}
