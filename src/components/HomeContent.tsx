import type { ReactNode } from 'react';
import { ChevronRight, FolderOpen, Plus } from 'lucide-react';
import type { Bootstrap, MediaItem, MediaPart } from '../shared/types';
import { Card } from './Card';
import { MediaGrid } from './MediaGrid';
import { SectionHeading } from './SectionHeading';
import { resumePosition } from '../shared/playback-progress';
import { FeedRefresh } from './FeedRefresh';
import { LibraryButton } from './LibraryButton';

interface Props {
  boot: Bootstrap;
  loading: boolean;
  opening: boolean;
  libraryBusy: boolean;
  libraryFeedback: ReactNode;
  results: ReactNode;
  play: (item: MediaItem, part?: MediaPart) => void;
  details: (item: MediaItem) => void;
  history: () => void;
  addDirectory: () => void;
  refresh: () => void;
}

export function HomeContent(props: Props) {
  const { boot, play, details } = props;
  const history = boot.history.filter(entry => resumePosition(entry) > 0).slice(0, 4);
  return (
    <>
      {history.length > 0 && (
        <section>
          <SectionHeading title="继续观看">
            <button className="text-button" onClick={props.history}>全部记录<ChevronRight size={16} /></button>
          </SectionHeading>
          <div className="media-grid">
            {history.map(entry => (
              <Card key={`${entry.item.id}:${entry.part?.id}`} item={entry.item} history={entry}
                open={() => play(entry.item, entry.part)} details={() => details(entry.item)} />
            ))}
          </div>
        </section>
      )}
      <section>
        <SectionHeading title="为你推荐">
          <FeedRefresh label="换一批" className="text-button" loading={props.loading}
            available={boot.account.app} refresh={props.refresh} />
        </SectionHeading>
        {props.results}
      </section>
      <section data-local-library aria-busy={props.libraryBusy}>
        <SectionHeading title="本地片库">
          {boot.library.length > 0 && (
            <LibraryButton className="text-button" blocked={props.opening} busy={props.libraryBusy} action={props.addDirectory}>
              <Plus size={16} />添加目录
            </LibraryButton>
          )}
        </SectionHeading>
        {props.libraryFeedback}
        {boot.library.length ? (
          <MediaGrid items={boot.library.slice(-4).reverse()} play={play} details={details} />
        ) : (
          <div className="local-invitation">
            <div className="folder-illustration"><FolderOpen size={30} /></div>
            <h3>尚未添加本地视频</h3>
            <LibraryButton blocked={props.opening} busy={props.libraryBusy} action={props.addDirectory}>
              添加视频目录<ChevronRight size={16} />
            </LibraryButton>
          </div>
        )}
      </section>
    </>
  );
}
