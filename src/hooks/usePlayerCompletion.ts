import { useEffect, useRef, useState } from 'react';

interface Options {
  sessionId: string;
  autoNext: boolean;
  covered: boolean;
  switching: boolean;
  error: boolean;
  advance: () => void;
}

/** Completion is consumed once; active edits defer automatic playback only. */
export function usePlayerCompletion(options: Options) {
  const pending = useRef<string | undefined>(undefined);
  const finished = useRef<string | undefined>(undefined);
  const advance = useRef(options.advance);
  advance.current = options.advance;
  const [revision, setRevision] = useState(0);
  const { sessionId, autoNext, covered, switching, error } = options;
  useEffect(() => {
    if (!autoNext || error || pending.current !== sessionId) {
      pending.current = undefined;
      return;
    }
    if (covered || switching) return;
    pending.current = undefined;
    advance.current();
  }, [sessionId, autoNext, covered, switching, error, revision]);
  useEffect(() => () => { pending.current = undefined; }, []);
  return {
    completed: () => finished.current === sessionId,
    finish: () => {
      if (finished.current === sessionId) return false;
      finished.current = sessionId;
      pending.current = autoNext ? sessionId : undefined;
      setRevision(value => value + 1);
      return true;
    },
    cancel: () => { pending.current = undefined; },
    restart: () => { pending.current = undefined; finished.current = undefined; },
  };
}
