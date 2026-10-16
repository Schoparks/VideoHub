import { Repeat2 } from 'lucide-react';
import type { DynamicItem, MediaItem } from '../shared/types';
import { CoverImage } from './CoverImage';
import { Card } from './Card';

interface DynamicActions {
  play: (item: MediaItem) => void;
  details: (item: MediaItem) => void;
}

function DynamicBody({ entry, play, details }: DynamicActions & { entry: DynamicItem }) {
  return (
    <>
      {entry.text && <p className={`dynamic-text${entry.video ? ' dynamic-video-text' : ''}`}
        tabIndex={entry.video ? 0 : undefined} data-scroll-content={!!entry.video || undefined}
        data-scroll-label="滚动动态正文">{entry.text}</p>}
      {entry.video && (
        <Card item={entry.video} open={() => play(entry.video!)} details={() => details(entry.video!)} />
      )}
      {!!entry.images.length && (
        <div className={`dynamic-images ${entry.images.length === 1 ? 'single' : ''}`}>
          {entry.images.map((src, index) => (
            <CoverImage key={`${src}:${index}`} src={src} alt={`动态配图 ${index + 1}`} loading="lazy" artworkSize={1440} />
          ))}
        </div>
      )}
      {entry.original && (
        <div className="dynamic-original">
          <p className="dynamic-repost"><Repeat2 size={15} />{entry.original.author}</p>
          <DynamicBody entry={entry.original} play={play} details={details} />
        </div>
      )}
    </>
  );
}

export function DynamicFeed({ entries, play, details }: DynamicActions & { entries: DynamicItem[] }) {
  return (
    <div className="dynamic-feed media-grid">
      {entries.map(entry => (
        <article key={entry.id} className={`dynamic-entry${entry.video ? ' dynamic-video-entry' : ''}`}
          tabIndex={entry.video ? undefined : 0}
          data-scroll-content={!entry.video || undefined} data-scroll-label="滚动动态"
          aria-label={`${entry.author}的动态${entry.text ? `：${entry.text.slice(0, 60)}` : ''}`}>
          <header>
            <span className="dynamic-avatar">
              <CoverImage src={entry.avatar} alt="" artworkSize={160} fallback={<span>{entry.author.slice(0, 1)}</span>} />
            </span>
            <div>
              <h3 title={entry.author}>{entry.author}</h3>
              {entry.publishedAt && (
                <time dateTime={new Date(entry.publishedAt).toISOString()}>
                  {new Date(entry.publishedAt).toLocaleString('zh-CN', {
                    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </time>
              )}
            </div>
          </header>
          <DynamicBody entry={entry} play={play} details={details} />
        </article>
      ))}
    </div>
  );
}
