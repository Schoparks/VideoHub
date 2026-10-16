import type { ReactNode } from 'react';
import { Play } from 'lucide-react';

interface Props {
  icon?: typeof Play;
  title: string;
  description?: string;
  children?: ReactNode;
}

export function EmptyState({ icon: Icon = Play, title, description, children }: Props) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true"><Icon size={28} /></span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children && <div className="button-row">{children}</div>}
    </div>
  );
}
