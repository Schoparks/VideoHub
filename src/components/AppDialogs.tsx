import type { ReactNode } from 'react';
import type { Bootstrap, MediaItem, MediaPart, Preferences } from '../shared/types';
import type { Dialog } from '../navigation';
import { Account } from './Account';
import { Details } from './Details';
import { Modal } from './Modal';
import { SearchInput } from './SearchInput';
import { Settings } from './Settings';
import { UrlForm } from './UrlForm';
import type { CollectionChange } from '../shared/collection-change';

interface Props {
  dialog: NonNullable<Dialog>;
  boot: Bootstrap;
  selected?: MediaItem;
  opening: boolean;
  queueBusy: boolean;
  device: string;
  isWatchLater: boolean;
  queue: ReactNode;
  query: string;
  url: string;
  close: () => void;
  setQuery: (value: string) => void;
  setUrl: (value: string) => void;
  search: (value?: string) => void;
  openUrl: (failure: (message: string) => void) => Promise<void>;
  accountChanged: (account: Bootstrap['account']) => void;
  preferencesChanged: (value: Preferences) => void;
  play: (item: MediaItem, part?: MediaPart) => void;
  enqueue: (item: MediaItem) => void;
  notify: (message: string) => void;
  collectionChanged: (change: CollectionChange) => void;
}

const titles: Record<NonNullable<Dialog>, string> = {
  account: '连接 B 站', settings: '设置', details: '视频详情',
  url: '打开链接', queue: '播放队列', search: '搜索',
};

export function AppDialogs(props: Props) {
  const { dialog, boot } = props;
  return (
    <Modal title={titles[dialog]} close={props.close} wide={dialog === 'details' || dialog === 'settings'}>
      {dialog === 'account' && <Account account={boot.account} update={props.accountChanged} notify={props.notify} />}
      {dialog === 'details' && props.selected && (
        <Details item={props.selected} play={props.play} enqueue={props.enqueue} notify={props.notify} isWatchLater={props.isWatchLater}
          opening={props.opening} queued={boot.queue.some(item => item.id === props.selected?.id)} queueBusy={props.queueBusy}
          collectionChanged={props.collectionChanged} />
      )}
      {dialog === 'settings' && <Settings value={boot.preferences} change={props.preferencesChanged} device={props.device} />}
      {dialog === 'queue' && props.queue}
      {dialog === 'url' && (
        <UrlForm value={props.url} opening={props.opening} change={props.setUrl} open={props.openUrl} />
      )}
      {dialog === 'search' && <SearchInput value={props.query} submit={props.search} />}
    </Modal>
  );
}
