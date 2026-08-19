import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import MobileDrawer from './MobileDrawer';
import SearchAutocomplete from './SearchAutocomplete';
import { IconMenu, NavIcon, NavIconBox, type NavIconName } from './NavIcons';

const NAV_LINKS: { id: string; label: string; icon: NavIconName; to: string }[] = [
  { id: 'all', label: 'Live', icon: 'live', to: '/' },
  { id: 'Sport', label: 'Sport', icon: 'sport', to: '/?cat=Sport' },
  { id: 'Cinéma', label: 'Cinéma', icon: 'cinema', to: '/?cat=Cinéma' },
  { id: 'Jeunesse', label: 'Jeunesse', icon: 'kids', to: '/?cat=Jeunesse' },
  { id: 'Info', label: 'Info', icon: 'info', to: '/?cat=Info' },
  { id: 'Musique', label: 'Musique', icon: 'music', to: '/?cat=Musique' },
];

function NavPill({
  active,
  icon,
  label,
  to,
}: {
  active: boolean;
  icon: NavIconName;
  label: string;
  to: string;
}) {
  return (
    <Link to={to} className={`nav-pill ${active ? 'nav-pill--active' : ''}`} aria-current={active ? 'page' : undefined}>
      <span className="nav-pill__icon">
        <NavIcon name={icon} className="h-4 w-4" />
      </span>
      {label}
    </Link>
  );
}

export default function Navbar() {
  const [query, setQuery] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const activeCat = params.get('cat') || 'all';

  function isActive(id: string) {
    if (location.pathname !== '/') return false;
    if (id === 'all') return !params.get('cat');
    return activeCat === id;
  }

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/6 bg-black">
        <div className="mx-auto flex h-[64px] max-w-[1440px] items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:h-[76px] lg:gap-4 lg:px-5">
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-juxt-primary/25 text-juxt-primary lg:hidden"
            aria-label="Ouvrir le menu"
            onClick={() => setDrawerOpen(true)}
          >
            <IconMenu className="h-5 w-5" />
          </button>

          <Link to="/" className="hidden shrink-0 items-center gap-2.5 lg:flex">
            <img src="/juxt-logo.png" alt="CineLab" className="h-9 w-auto object-contain" />
            <span className="font-display flex items-baseline gap-px text-xl font-extrabold tracking-wide">
              <span className="italic text-juxt-text">Cine</span>
              <span className="text-juxt-primary">Lab</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Catégories">
            {NAV_LINKS.map((item) => (
              <NavPill key={item.id} active={isActive(item.id)} icon={item.icon} label={item.label} to={item.to} />
            ))}
          </nav>

          <SearchAutocomplete
            value={query}
            onChange={setQuery}
            onPick={() => setDrawerOpen(false)}
            className="min-w-0 flex-1 lg:max-w-[320px] lg:flex-none xl:max-w-[360px]"
          />

          <Link to="/" className="shrink-0 lg:hidden" aria-label="Accueil">
            <img src="/juxt-logo.png" alt="" className="h-9 w-9 object-contain" />
          </Link>
        </div>
      </header>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <nav className="flex flex-col gap-2" aria-label="Menu mobile">
          {NAV_LINKS.map((item) => (
            <Link
              key={item.id}
              to={item.to}
              onClick={() => setDrawerOpen(false)}
              className={[
                'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm font-bold uppercase tracking-wide transition-colors',
                isActive(item.id)
                  ? 'border-juxt-primary/45 bg-juxt-primary/14 text-juxt-primary shadow-[0_0_0_1px_rgba(34,197,94,0.2)]'
                  : 'border-transparent text-juxt-text hover:border-juxt-primary/20 hover:bg-juxt-primary/8',
              ].join(' ')}
            >
              <NavIconBox name={item.icon} active={isActive(item.id)} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 border-t border-white/8 pt-4">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2.5 text-left text-sm font-bold uppercase tracking-wide text-juxt-text hover:bg-juxt-primary/8"
            onClick={() => {
              setDrawerOpen(false);
              navigate('/search');
            }}
          >
            <NavIconBox name="search" />
            Recherche
          </button>
        </div>
      </MobileDrawer>
    </>
  );
}
