import { Film, FolderOpen, Home, Library, Radio, Tv } from 'lucide-react';

export type Route = 'home' | 'bilibili' | 'live' | 'cinema' | 'local' | 'mine' | 'search';
export type Dialog = 'account' | 'url' | 'settings' | 'details' | 'search' | 'queue' | null;

export const navigation: { id: Route; label: string; icon: typeof Home }[] = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'bilibili', label: '哔哩哔哩', icon: Tv },
  { id: 'live', label: '关注直播', icon: Radio },
  { id: 'cinema', label: '番剧与影视', icon: Film },
  { id: 'local', label: '本地片库', icon: FolderOpen },
  { id: 'mine', label: '我的收藏', icon: Library },
];
