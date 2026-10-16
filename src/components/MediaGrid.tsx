import type { MediaItem } from '../shared/types';
import { Card } from './Card';

interface Props {
  items: MediaItem[];
  play: (item: MediaItem) => void;
  details: (item: MediaItem) => void;
}

export function MediaGrid({ items, play, details }: Props) {
  return (
    <div className="media-grid">
      {items.map(item => (
        <Card key={item.id} item={item} open={() => play(item)} details={() => details(item)} />
      ))}
    </div>
  );
}
