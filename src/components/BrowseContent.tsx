import type { ReactNode } from 'react';
import { Clock3 } from 'lucide-react';
import type { Bootstrap, Folder, MediaItem, MediaPart, SearchType } from '../shared/types';
import type { Route } from '../navigation';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { HomeContent } from './HomeContent';
import { MediaGrid } from './MediaGrid';
import { SectionHeading } from './SectionHeading';
import { FilterChips } from './FilterChips';
import { LocalContent } from './LocalContent';
import type { LibraryOperation } from '../hooks/useLibraryActions';
import { FeedRefresh } from './FeedRefresh';

interface Props {
  route: Route;
  tab: string;
  boot: Bootstrap;
  loading: boolean;
  opening: boolean;
  libraryBusy?: LibraryOperation;
  libraryFeedback: ReactNode;
  canLoad: boolean;
  keyword: string;
  dynamicType: 'all' | 'video';
  searchType: SearchType;
  region: number;
  cinema: number;
  folder: number;
  folders: Folder[];
  results: ReactNode;
  queue: ReactNode;
  setTab: (value: string) => void;
  setDynamicType: (value: 'all' | 'video') => void;
  setSearchType: (value: SearchType) => void;
  setRegion: (value: number) => void;
  setCinema: (value: number) => void;
  setFolder: (value: number) => void;
  navigate: (route: Route, tab?: string) => void;
  refresh: () => void;
  addDirectory: () => void;
  rescan: () => void;
  play: (item: MediaItem, part?: MediaPart) => void;
  details: (item: MediaItem) => void;
}

const regions = [[4, '游戏'], [36, '知识'], [188, '科技'], [160, '生活'], [3, '音乐'], [1, '动画'], [211, '美食'], [181, '影视']] as const;
const cinemaTypes = [[1, '番剧'], [2, '电影'], [3, '纪录片'], [4, '国创'], [5, '电视剧'], [7, '综艺']] as const;
const tabs: Partial<Record<Route, [string, string][]>> = {
  bilibili: [['recommend', 'App 推荐'], ['dynamic', '关注动态'], ['regions', '分区浏览']],
  cinema: [['cinema', '发现影视'], ['followingCinema', '我的追番追剧']],
  mine: [['watchlater', '稍后再看'], ['favorites', 'B 站收藏'], ['history', 'B 站历史'], ['localHistory', '本机历史'], ['queue', '播放队列']],
};

export function BrowseContent(props: Props) {
  const { route, tab, boot, play, details, results } = props;
  if (route === 'home') {
    return <HomeContent boot={boot} loading={props.loading} opening={props.opening} results={results} play={play} details={details}
      libraryBusy={!!props.libraryBusy} libraryFeedback={props.libraryFeedback}
      history={() => props.navigate('mine', 'localHistory')} addDirectory={props.addDirectory} refresh={props.refresh} />;
  }
  if (route === 'local') {
    return <LocalContent items={boot.library} busy={props.libraryBusy} opening={props.opening}
      feedback={props.libraryFeedback} add={props.addDirectory} rescan={props.rescan} play={play} details={details} />;
  }
  if (route === 'search') {
    const localResults = boot.library.filter(item => item.title.toLowerCase().includes(props.keyword.toLowerCase()));
    return (
      <>
        <section>
          <SectionHeading title="B 站" />
          <FilterChips<SearchType> label="搜索类型" value={props.searchType} change={props.setSearchType}
            options={[{ id: 'all', label: '全部' }, { id: 'video', label: '视频' }, { id: 'media_bangumi', label: '番剧' }, { id: 'media_ft', label: '影视' }, { id: 'live_room', label: '直播' }]}>
            <span className="tab-spacer" />
            <FeedRefresh label="刷新" loading={props.loading} available={props.canLoad} refresh={props.refresh} />
          </FilterChips>
          {results}
        </section>
        {localResults.length > 0 && (
          <section><SectionHeading title="本地片库" /><MediaGrid items={localResults} play={play} details={details} /></section>
        )}
      </>
    );
  }
  return (
    <>
      {tabs[route] && <div className="tabs" role="group" aria-label="栏目筛选" data-browse-nav>
        {tabs[route]?.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => props.setTab(id)}>
            {label}{id === 'queue' && boot.queue.length > 0 && <span className="count">{boot.queue.length}</span>}
          </button>
        ))}
        {route === 'bilibili' && (
          <>
            <span className="tab-spacer" />
            <FeedRefresh label="刷新" loading={props.loading} available={props.canLoad} refresh={props.refresh} />
          </>
        )}
      </div>}
      {route === 'bilibili' && tab === 'dynamic' && (
        <FilterChips<'all' | 'video'> label="动态筛选" value={props.dynamicType} change={props.setDynamicType}
          options={[{ id: 'all', label: '全部' }, { id: 'video', label: '视频' }]} />
      )}
      {route === 'bilibili' && tab === 'regions' && (
        <FilterChips label="视频分区" value={props.region} change={props.setRegion}
          options={regions.map(([id, label]) => ({ id, label }))} />
      )}
      {route === 'cinema' && (
        <FilterChips label="影视分类" value={props.cinema} change={props.setCinema}
          options={cinemaTypes.filter(([id]) => tab !== 'followingCinema' || id === 1 || id === 2)
            .map(([id, label]) => ({ id, label: tab === 'followingCinema' ? id === 1 ? '追番' : '追剧' : label }))} />
      )}
      {route === 'mine' && tab === 'favorites' && props.folders.length > 0 && (
        <FilterChips label="收藏夹" value={props.folder} change={props.setFolder}
          options={props.folders.map(folder => ({ id: folder.id, label: folder.title, count: folder.count }))} />
      )}
      {route === 'mine' && tab === 'queue' ? props.queue : route === 'mine' && tab === 'localHistory' ? (
        boot.history.length ? (
          <div className="media-grid">
            {boot.history.map(entry => (
              <Card key={`${entry.item.id}:${entry.part?.id}`} item={entry.item} history={entry}
                open={() => play(entry.item, entry.part)} details={() => details(entry.item)} />
            ))}
          </div>
        ) : <EmptyState icon={Clock3} title="暂无观看记录" />
      ) : results}
    </>
  );
}
