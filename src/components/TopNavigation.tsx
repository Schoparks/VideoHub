import { Settings2 } from 'lucide-react';
import { navigation, type Route } from '../navigation';

interface Props {
  route: Route;
  navigate: (route: Route) => void;
  settings: () => void;
}

export function TopNavigation({ route, navigate, settings }: Props) {
  return (
    <div className="navigation-bar">
      <nav aria-label="主导航">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${route === id ? 'active' : ''}`}
            aria-label={label}
            aria-current={route === id ? 'page' : undefined}
            title={label}
            onClick={() => navigate(id)}
          >
            <Icon size={21} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <button className="nav-item" aria-label="设置" title="设置" onClick={settings}>
        <Settings2 size={20} /><span>设置</span>
      </button>
    </div>
  );
}
