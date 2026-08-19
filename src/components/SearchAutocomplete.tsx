import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getChannels, watchPath } from '../lib/api';
import type { Channel } from '../types';
import { IconSearch } from './NavIcons';

interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  onPick?: () => void;
}

export default function SearchAutocomplete({ value, onChange, className = '', onPick }: Props) {
  const navigate = useNavigate();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Channel[]>([]);
  const [highlight, setHighlight] = useState(-1);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 1) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      getChannels(undefined, term)
        .then((data) => setResults(data.channels.slice(0, 8)))
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  function goChannel(channel: Channel) {
    setOpen(false);
    onPick?.();
    navigate(watchPath(channel));
  }

  function goSearch() {
    const term = value.trim();
    if (!term) return;
    setOpen(false);
    onPick?.();
    navigate(`/search?q=${encodeURIComponent(term)}`);
  }

  return (
    <div ref={rootRef} className={`search-autocomplete ${className}`}>
      <form
        className="search-autocomplete__form search-autocomplete__form--navbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (highlight >= 0 && results[highlight]) goChannel(results[highlight]);
          else goSearch();
        }}
      >
        <div className="search-autocomplete__field">
          <IconSearch className="ml-3 h-4 w-4 shrink-0 text-juxt-primary" />
          <input
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
              setHighlight(-1);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Rechercher une chaîne..."
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls={listId}
          />
        </div>
      </form>
      {open && value.trim() && (
        <div id={listId} className="search-suggest" role="listbox">
          {results.map((channel, index) => (
            <button
              type="button"
              key={channel.id}
              className={`search-suggest-item ${highlight === index ? 'search-suggest-item--active' : ''}`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => goChannel(channel)}
            >
              <img src={channel.logo || '/placeholder.svg'} alt="" />
              <span className="search-suggest-item__text">
                <strong>{channel.name}</strong>
                <small>{channel.category}</small>
              </span>
            </button>
          ))}
          <button type="button" className="search-suggest-all" onClick={goSearch}>
            Voir tous les résultats
          </button>
        </div>
      )}
    </div>
  );
}
