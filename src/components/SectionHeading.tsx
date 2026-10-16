import type { ReactNode } from 'react';

export function SectionHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
