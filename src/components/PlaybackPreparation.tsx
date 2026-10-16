import { RefreshCw } from 'lucide-react';

interface Props {
  cancel?: () => void;
}

export function PlaybackPreparation({ cancel }: Props) {
  return (
    <div className="working-pill">
      <span role="status"><RefreshCw size={16} className="spin" />正在准备…</span>
      {cancel && <button onClick={cancel} aria-label="取消准备播放">取消</button>}
    </div>
  );
}
