import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import ChannelCard from '../components/ChannelCard';
import { getChannels } from '../lib/api';
import type { Channel } from '../types';

const GRID_CLASS =
  'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7';

function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className={GRID_CLASS}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card" />
      ))}
    </div>
  );
}

export default function Home() {
  const [params, setParams] = useSearchParams();
  const activeCat = params.get('cat') || 'all';
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await getChannels();
        if (cancelled) return;
        setChannels(data.channels);
        setCategories(data.categories);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erreur');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (activeCat === 'all') return channels;
    return channels.filter((ch) => ch.category === activeCat);
  }, [channels, activeCat]);

  const hero = filtered[0] || channels[0] || null;
  const grouped = useMemo(() => {
    const map: Record<string, Channel[]> = {};
    for (const channel of channels) {
      (map[channel.category] ||= []).push(channel);
    }
    return map;
  }, [channels]);

  function setCat(cat: string) {
    const next = new URLSearchParams(params);
    if (cat === 'all') next.delete('cat');
    else next.set('cat', cat);
    setParams(next);
  }

  return (
    <div className="home">
      {loading ? (
        <div className="skeleton-hero" />
      ) : hero ? (
        <section
          className="hero relative min-h-[280px] bg-cover bg-center sm:min-h-[340px] md:min-h-[420px]"
          style={{ backgroundImage: `url(${hero.logo})` }}
        >
          <div className="hero-overlay" />
          <div className="hero-content px-4 py-10 sm:px-8 sm:py-14 md:px-12">
            <span className="hero-tag">En direct</span>
            <h1 className="max-w-3xl text-2xl font-extrabold sm:text-3xl md:text-4xl lg:text-5xl">
              {hero.name}
            </h1>
            <p className="hero-meta">{hero.category} · TV live</p>
            <Link to={`/watch/${hero.id}`} className="btn-primary">
              ▶ Regarder
            </Link>
          </div>
        </section>
      ) : null}

      <div className="home-controls px-4 sm:px-6">
        <nav className="section-tabs" aria-label="Catégories">
          {['all', ...categories].map((cat) => (
            <button
              key={cat}
              type="button"
              className={`section-tab ${activeCat === cat ? 'active' : ''}`}
              onClick={() => setCat(cat)}
            >
              {cat === 'all' ? 'Toutes' : cat}
            </button>
          ))}
        </nav>
      </div>

      {error && <div className="page-error">{error}</div>}

      {loading && (
        <section className="section max-w-[1440px] mx-auto px-4 py-7 sm:px-6 md:py-10">
          <SkeletonGrid />
        </section>
      )}

      {!loading && activeCat !== 'all' && (
        <section className="section max-w-[1440px] mx-auto px-4 py-7 sm:px-6 md:py-10">
          <div className="section-head">
            <h2>{activeCat}</h2>
            <span className="section-desc">{filtered.length} chaînes en direct</span>
          </div>
          <div className={GRID_CLASS}>
            {filtered.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} />
            ))}
          </div>
        </section>
      )}

      {!loading && activeCat === 'all' &&
        categories.map((cat) => (
          <section className="section max-w-[1440px] mx-auto px-4 py-7 sm:px-6 md:py-10" key={cat}>
            <div className="section-head">
              <h2>{cat}</h2>
              <button type="button" className="section-desc" onClick={() => setCat(cat)}>
                Voir tout
              </button>
            </div>
            <div className={GRID_CLASS}>
              {(grouped[cat] || []).slice(0, 14).map((channel) => (
                <ChannelCard key={channel.id} channel={channel} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
