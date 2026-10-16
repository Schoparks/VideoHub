import { RefreshCw } from 'lucide-react';

interface Props {
  label: string;
  loading: boolean;
  available: boolean;
  className?: string;
  refresh: () => void;
}

export function FeedRefresh({ label, loading, available, className, refresh }: Props) {
  return (
    <button className={className} disabled={!available}
      aria-disabled={loading || !available} data-focus-retain
      onClick={() => { if (available && !loading) refresh(); }}>
      <RefreshCw size={16} className={loading ? 'spin' : ''} />{label}
    </button>
  );
}
