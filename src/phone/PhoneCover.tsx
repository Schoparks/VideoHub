import { useEffect, useRef, useState } from 'react';
import type { CompanionCard } from '../shared/companion';
import { sendCommand } from './connection';

const images = new Map<string, string>();
let chain = Promise.resolve();
let lastRead = 0;
export function PhoneCover({ item }: { item: Pick<CompanionCard, 'handle' | 'artwork' | 'source' | 'kind'> }) {
  const host = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState(images.get(item.handle));
  useEffect(() => {
    let active = true;
    setImage(images.get(item.handle));
    if (!item.artwork || images.has(item.handle)) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      chain = chain.then(async () => {
        const delay = Math.max(0, 200 - (Date.now() - lastRead));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (!active) return;
        lastRead = Date.now();
        try {
          const result = await sendCommand({ kind: 'cover', handle: item.handle });
          if (!result.image) return;
          images.set(item.handle, result.image);
          if (images.size > 100) images.delete(images.keys().next().value!);
          if (active) setImage(result.image);
        } catch { /* A missing cover does not remove the playable title. */ }
      });
    }, { rootMargin: '120px' });
    if (host.current) observer.observe(host.current);
    return () => { active = false; observer.disconnect(); };
  }, [item.handle, item.artwork]);
  return <span className="phone-cover" ref={host}>
    {image ? <img src={image} alt="" /> : <span>{item.source === 'local' ? '本地视频' : '暂无封面'}</span>}
    {item.kind === 'live' && <small>直播</small>}
  </span>;
}

