import { browseTabs, cinemaTypes, regions } from '../browse-sections';
import type { Route } from '../navigation';
import type { PhoneCatalog } from './PhoneBrowse';

export function PhoneBrowseFilters({ route, request, change }: {
  route: Route; request: PhoneCatalog; change: (value: PhoneCatalog) => void;
}) {
  const category = (value: string) => change({ ...request, category: Number(value) });
  return <>
    {browseTabs[route] && <nav className="phone-categories" aria-label="栏目筛选">
      {browseTabs[route]!.map(([id, label]) => <button key={id} aria-pressed={request.collection === id}
        onClick={() => change({ kind: 'catalog', collection: id as PhoneCatalog['collection'],
          category: id === 'regions' ? 4 : id === 'cinema' || id === 'followingCinema' ? 1 : undefined,
          dynamicType: id === 'dynamic' ? 'all' : undefined })}>{label}</button>)}
    </nav>}
    {request.collection === 'dynamic' && <label className="phone-field">动态筛选<select aria-label="动态筛选" value={request.dynamicType || 'all'}
      onChange={event => change({ ...request, dynamicType: event.target.value as 'all' | 'video' })}>
      <option value="all">全部</option><option value="video">视频</option>
    </select></label>}
    {request.collection === 'regions' && <label className="phone-field">视频分区<select aria-label="视频分区" value={request.category || 4} onChange={event => category(event.target.value)}>
      {regions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>}
    {route === 'cinema' && <label className="phone-field">影视分类<select aria-label="影视分类" value={request.category || 1} onChange={event => category(event.target.value)}>
      {cinemaTypes.filter(([id]) => request.collection !== 'followingCinema' || id === 1 || id === 2)
        .map(([id, label]) => <option key={id} value={id}>{request.collection === 'followingCinema' ? id === 1 ? '追番' : '追剧' : label}</option>)}
    </select></label>}
  </>;
}
