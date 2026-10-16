import { Film, Library, LogIn, RefreshCw, Tv } from 'lucide-react';
import type { AccountStatus, BrowseKind, MediaItem, Page } from '../shared/types';
import { DynamicFeed } from './DynamicFeed';
import { EmptyState } from './EmptyState';
import { MediaGrid } from './MediaGrid';

interface Props {
  kind?: BrowseKind;
  data: Page;
  account: AccountStatus;
  loading: boolean;
  error: string;
  retrying?: string;
  readyForFocus?: boolean;
  emptyTitle?: string;
  connect: () => void;
  retry: () => void;
  play: (item: MediaItem) => void;
  details: (item: MediaItem) => void;
}

export function FeedResults(props: Props) {
  const { kind, data, account, loading, error, play, details } = props;
  const needsApp = kind === 'recommend' && !account.app;
  const needsWeb = kind && ['dynamic', 'history', 'favorites', 'watchlater', 'followingLive', 'followingCinema'].includes(kind) && !account.web;
  const hasContent = kind === 'dynamic' ? !!data.dynamics?.length : data.items.length > 0;
  const retryFeedback = (error || props.retrying) && (
    <div className="inline-error" role="alert">
      <span>{error || props.retrying}</span>
      <button aria-disabled={loading} data-focus-retain onClick={() => { if (!loading) props.retry(); }}>
        <RefreshCw size={16} className={loading ? 'spin' : ''} />重试
      </button>
    </div>
  );
  return (
    <div className="feed-results" aria-busy={loading} data-browse-ready={props.readyForFocus ?? true}>
      {!hasContent && retryFeedback}
      {hasContent ? (
        kind === 'dynamic' ? <DynamicFeed entries={data.dynamics!} play={play} details={details} />
          : <MediaGrid items={data.items} play={play} details={details} />
      ) : needsApp || needsWeb ? (
        <EmptyState icon={needsApp ? Tv : Library} title={needsApp ? '连接 B 站，查看推荐' : '连接账号，查看内容'}
          description={needsApp ? '使用 B 站 App 扫码授权。' : '需要连接 B 站网页账号。'}>
          <button className="primary" onClick={props.connect}><LogIn size={17} />连接 B 站</button>
        </EmptyState>
      ) : !retryFeedback && (loading || data.hasMore) ? (
        <div className="loading" role="status"><RefreshCw size={20} className="spin" />正在加载…</div>
      ) : !retryFeedback ? <EmptyState icon={Film} title={props.emptyTitle || '暂无内容'} /> : null}
      {data.notice && <p className="notice">{data.notice}</p>}
      {hasContent && retryFeedback}
      {hasContent && loading && (
        <div className="feed-loading" role="status">
          <RefreshCw size={17} className="spin" />正在加载…
        </div>
      )}
    </div>
  );
}
