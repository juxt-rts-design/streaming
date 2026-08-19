import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ChannelCard from '../components/ChannelCard';
import { getChannels } from '../lib/api';
import type { Channel } from '../types';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const [input, setInput] = useState(query);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setInput(query);
    if (!query.trim()) {
      setChannels([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getChannels(undefined, query)
      .then((data) => {
        if (!cancelled) setChannels(data.channels);
      })
      .catch(() => {
        if (!cancelled) setChannels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="section max-w-[1440px] mx-auto px-4 py-8 sm:px-6">
      <div className="section-head">
        <h2>Recherche</h2>
      </div>
      <form
        className="search-form mb-8 max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params);
          next.set('q', input.trim());
          setParams(next);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Nom de chaîne..."
        />
      </form>
      {loading && <p className="hero-meta">Recherche…</p>}
      {!loading && query && channels.length === 0 && (
        <p className="hero-meta">Aucune chaîne pour « {query} »</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {channels.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} />
        ))}
      </div>
    </div>
  );
}
