import type { ReactNode } from 'react';

interface Option<T extends string | number> { id: T; label: string; count?: number }
interface Props<T extends string | number> {
  label: string;
  options: readonly Option<T>[];
  value: T;
  change: (value: T) => void;
  children?: ReactNode;
}

export function FilterChips<T extends string | number>({ label, options, value, change, children }: Props<T>) {
  return (
    <div className="chips" role="group" aria-label={label} data-browse-nav>
      {options.map(option => (
        <button key={option.id} className={value === option.id ? 'selected' : ''}
          aria-pressed={value === option.id} title={option.label} onClick={() => change(option.id)}>
          <span className="chip-label">{option.label}</span>
          {option.count !== undefined && <small>{option.count}</small>}
        </button>
      ))}
      {children}
    </div>
  );
}
