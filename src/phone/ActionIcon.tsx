import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Check, Undo2, Menu, ListVideo,
  Search, SkipBack, SkipForward, Rewind, FastForward, Play, Pause,
} from 'lucide-react';
import type { ControllerAction } from '../shared/remote-control';

const icons = {
  up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight, confirm: Check,
  back: Undo2, menu: Menu, details: ListVideo, search: Search, previous: SkipBack,
  next: SkipForward, rewind: Rewind, forward: FastForward, pause: Play,
};

export function ActionIcon({ action }: { action: ControllerAction }) {
  if (action === 'pause') return <span className="play-pause"><Play size={18} aria-hidden="true" /><Pause size={15} aria-hidden="true" /></span>;
  const Icon = icons[action];
  return <Icon size={23} aria-hidden="true" />;
}
