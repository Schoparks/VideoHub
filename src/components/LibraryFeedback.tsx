import { RefreshCw } from 'lucide-react';
import type { LibraryOperation } from '../hooks/useLibraryActions';
import { LibraryButton } from './LibraryButton';

interface Props { busy?: LibraryOperation; error: string; retry: () => void; compact?: boolean }

export function LibraryFeedback({ busy, error, retry, compact }: Props) {
  return (
    <>
      {error && <div className="inline-error" role="alert">
        <span>{error}</span>
        <LibraryButton busy={!!busy} action={retry}><RefreshCw size={16} />重试</LibraryButton>
      </div>}
      {busy && <div className={compact ? 'working-pill' : 'loading'} role="status">
        <RefreshCw size={16} className="spin" />{busy === 'rescan' ? '正在扫描片库…' : '正在添加媒体…'}
      </div>}
    </>
  );
}
