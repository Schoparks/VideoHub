import type { RefObject } from 'react';
import type { usePlayerMedia } from '../hooks/usePlayerMedia';
import type { usePlayerCompletion } from '../hooks/usePlayerCompletion';

interface Props {
  session: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  media: ReturnType<typeof usePlayerMedia>;
  completion: ReturnType<typeof usePlayerCompletion>;
  leaving: () => boolean;
  blocked: () => boolean;
  editing: boolean;
  toggle: () => void;
  reveal: (focus?: boolean) => void;
  duration: (value: number) => void;
  loading: (value: boolean) => void;
  paused: (value: boolean) => void;
  ended: (value: boolean) => void;
}

export function PlayerVideo(props: Props) {
  const { media, completion } = props;
  return <video key={props.session} ref={props.videoRef} playsInline onClick={props.toggle}
    poster={window.hubPlatform === 'android' ? 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' : undefined}
    onTimeUpdate={event => media.timeUpdate(event.currentTarget.currentTime)}
    onDurationChange={event => props.duration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
    onWaiting={() => { if (!media.failed()) props.loading(true); }} onPlaying={() => {
      if (!media.playing()) return;
      props.loading(false);
      props.paused(false);
      props.ended(false);
    }}
    onPause={() => { props.paused(true); void media.flush(true); }}
    onEnded={() => {
      if (props.leaving() || media.failed() || !completion.finish()) return;
      if (props.blocked()) completion.cancel();
      media.setPlaying(false);
      props.ended(true);
      props.paused(true);
      props.loading(false);
      props.reveal(!props.editing);
      void media.flush(true);
    }}
    onError={() => media.fail()} />;
}
