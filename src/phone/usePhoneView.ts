import { useLayoutEffect, useRef, useState } from 'react';

/** Phone navigation belongs to the user; episode changes and polling never override it. */
export function usePhoneView(playing: boolean | undefined, identity: string) {
  const [view, setView] = useState<'home' | 'player'>('home');
  const [scrolled, setScrolled] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const positions = useRef({ home: 0, player: 0 });
  const revision = useRef(0), previousPlaying = useRef<boolean>(undefined), previousIdentity = useRef(identity);
  const currentView = useRef(view);
  const remember = () => {
    positions.current[currentView.current] = content.current?.scrollTop || 0;
  };
  const move = (next: 'home' | 'player') => {
    if (next === currentView.current) return;
    remember(); currentView.current = next; setView(next);
  };
  useLayoutEffect(() => {
    if (playing === undefined) return;
    const previous = previousPlaying.current;
    previousPlaying.current = playing;
    if (playing && previous !== true) move('player');
    if (!playing && previous === true) move('home');
    if (identity !== previousIdentity.current) {
      previousIdentity.current = identity;
      positions.current.player = 0;
      if (currentView.current === 'player') content.current?.scrollTo({ top: 0 });
    }
  }, [playing, identity]);
  useLayoutEffect(() => {
    const top = positions.current[view];
    content.current?.scrollTo({ top }); setScrolled(top > 400);
  }, [view]);
  return {
    view, content, scrolled,
    checkpoint: () => revision.current,
    isCurrent: (token: number) => token === revision.current,
    interact: () => { revision.current++; },
    home: () => { revision.current++; move('home'); },
    showPlayer: () => { revision.current++; move('player'); },
    opened: (token: number) => {
      if (token !== revision.current) return false;
      move('player'); return true;
    },
    scroll: () => { remember(); setScrolled((content.current?.scrollTop || 0) > 400); },
    top: () => content.current?.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }),
  };
}
