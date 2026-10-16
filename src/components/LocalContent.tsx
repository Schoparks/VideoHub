import type { ReactNode } from 'react';
import { FolderOpen, Plus, RefreshCw } from 'lucide-react';
import type { MediaItem } from '../shared/types';
import type { LibraryOperation } from '../hooks/useLibraryActions';
import { EmptyState } from './EmptyState';
import { MediaGrid } from './MediaGrid';
import { LibraryButton } from './LibraryButton';

interface Props {
  items: MediaItem[];
  busy?: LibraryOperation;
  opening: boolean;
  feedback: ReactNode;
  add: () => void;
  rescan: () => void;
  play: (item: MediaItem) => void;
  details: (item: MediaItem) => void;
}

export function LocalContent({ items, busy, opening, feedback, add, rescan, play, details }: Props) {
  return (
    <section data-local-library aria-busy={!!busy}>
      <div className="library-toolbar">
        <span>{items.length} 个媒体文件</span>
        <LibraryButton blocked={opening} busy={!!busy} action={rescan}>
          <RefreshCw size={16} className={busy === 'rescan' ? 'spin' : ''} />重新扫描
        </LibraryButton>
        {items.length > 0 && <LibraryButton className="primary" blocked={opening} busy={!!busy} action={add}>
          <FolderOpen size={17} />添加目录
        </LibraryButton>}
      </div>
      {feedback}
      {items.length ? <MediaGrid items={items} play={play} details={details} /> : (
        <EmptyState icon={FolderOpen} title="尚未添加本地视频">
          <LibraryButton className="primary" blocked={opening} busy={!!busy} action={add}>
            <Plus size={17} />添加视频目录
          </LibraryButton>
        </EmptyState>
      )}
    </section>
  );
}
