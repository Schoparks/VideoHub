import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DanmakuComment, PlaybackSource } from '../shared/types';

export function useDanmaku(source: PlaybackSource, enabled: boolean) {
  const [data, setData] = useState<{ session: string; comments: DanmakuComment[] }>({ session: '', comments: [] });
  const [error, setError] = useState('');
  const available = source.item.source === 'bilibili' && !source.live && !!(source.part?.cid || source.item.cid);
  useEffect(() => {
    let active = true;
    setData({ session: source.sessionId, comments: [] });
    setError('');
    if (enabled && available) {
      void api.danmaku(source.sessionId).then(comments => {
        if (active) setData({ session: source.sessionId, comments });
      }).catch(() => { if (active) setError('弹幕加载失败，关闭后可重新开启'); });
    }
    return () => { active = false; };
  }, [source.sessionId, enabled, available]);
  return { comments: enabled && data.session === source.sessionId ? data.comments : [],
    error: enabled && data.session === source.sessionId ? error : '', available };
}
