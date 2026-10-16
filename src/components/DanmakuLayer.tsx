import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { DanmakuComment, Preferences } from '../shared/types';
import { startDanmakuRenderer } from '../visual/danmaku-renderer';
import '../styles/danmaku.css';

interface Props {
  comments: DanmakuComment[];
  preferences: Preferences;
  video: RefObject<HTMLVideoElement | null>;
}

export function DanmakuLayer({ comments, preferences, video }: Props) {
  const [bounds, setBounds] = useState({ width: 0, height: 0, x: 0, y: 0 });
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const resize = () => {
      const width = element.clientWidth, height = element.clientHeight;
      const scale = element.videoWidth && element.videoHeight ? Math.min(width / element.videoWidth, height / element.videoHeight) : 1;
      const fittedWidth = element.videoWidth ? element.videoWidth * scale : width;
      const fittedHeight = element.videoHeight ? element.videoHeight * scale : height;
      setBounds({ width: fittedWidth, height: fittedHeight, x: (width - fittedWidth) / 2, y: (height - fittedHeight) / 2 });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    element.addEventListener('loadedmetadata', resize);
    resize();
    return () => { observer.disconnect(); element.removeEventListener('loadedmetadata', resize); };
  }, [video]);
  useEffect(() => {
    if (!comments.length || !host.current || !video.current || bounds.width <= 0) return;
    return startDanmakuRenderer(host.current, video.current, comments, bounds.width, bounds.height,
      preferences.danmakuFontSize, preferences.danmakuArea);
  }, [comments, video, bounds.width, bounds.height, preferences.danmakuFontSize, preferences.danmakuArea]);
  return (
    <div ref={host} className="danmaku-layer" aria-hidden="true" style={{
      left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height,
      '--danmaku-opacity': preferences.danmakuOpacity, fontSize: preferences.danmakuFontSize,
    } as CSSProperties} />
  );
}
