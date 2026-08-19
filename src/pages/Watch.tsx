import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import VideoPlayer, { isMobileDevice } from '../components/VideoPlayer';
import ChannelCard from '../components/ChannelCard';
import { getChannels, resolveStream } from '../lib/api';
import type { Channel, StreamInfo, StreamSource } from '../types';

// Sur mobile on démarre sur une source moins gourmande (HD plutôt que FHD/4K).
function pickInitialSource(sources?: StreamSource[]) {
  if (!sources || sources.length < 2 || !isMobileDevice()) return 0;
  const light = sources.findIndex((source) => (source.weight ?? 3) <= 2);
  return light >= 0 ? light : 0;
}

export default function Watch() {
  const { id } = useParams<{ id: string }>();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [srcIndex, setSrcIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const roundsRef = useRef(0);
  const switchingRef = useRef(false);

  const current = useMemo(
    () => channels.find((ch) => ch.id === id) || null,
    [channels, id],
  );

  useEffect(() => {
    let cancelled = false;
    getChannels()
      .then((data) => {
        if (!cancelled) setChannels(data.channels);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    roundsRef.current = 0;
    switchingRef.current = false;

    async function load() {
      setLoading(true);
      setError(null);
      setStream(null);
      setSrcIndex(0);
      try {
        const info = await resolveStream(id);
        if (!cancelled) {
          setStream(info);
          setSrcIndex(pickInitialSource(info.sources));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Flux introuvable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const sources = stream?.sources?.length
    ? stream.sources
    : stream?.playPath
      ? [{ url: stream.url, label: 'Par défaut', kind: 'default' as const, playPath: stream.playPath }]
      : [];
  const active = sources[srcIndex];
  const playUrl = active?.playPath || '';
  const watchdogMs = srcIndex === 0 ? 40000 : 22000;

  const nextSource = useCallback(() => {
    if (switchingRef.current || !id) return;
    switchingRef.current = true;

    if (srcIndex + 1 < sources.length) {
      setSrcIndex(srcIndex + 1);
      return;
    }

    if (roundsRef.current < 1) {
      roundsRef.current += 1;
      setLoading(true);
      void resolveStream(id)
        .then((info) => {
          setError(null);
          setStream(info);
          setSrcIndex(pickInitialSource(info.sources));
        })
        .catch(() => setError('Aucune source disponible'))
        .finally(() => {
          setLoading(false);
          switchingRef.current = false;
        });
      return;
    }

    setError('Aucune source disponible');
    switchingRef.current = false;
  }, [id, srcIndex, sources.length]);

  useEffect(() => {
    switchingRef.current = false;
  }, [playUrl]);

  const related = useMemo(() => {
    const cat = current?.category;
    return channels.filter((ch) => ch.id !== id && (!cat || ch.category === cat)).slice(0, 12);
  }, [channels, current, id]);

  const title = stream?.name || current?.name || 'CineLab';

  return (
    <div className="watch-play-page">
      <section className="section max-w-[1440px] mx-auto px-4 py-6 sm:px-6">
        <p className="hero-tag mb-3">En direct</p>
        <h1 className="mb-4 text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {current?.category && <p className="hero-meta">{current.category}</p>}
        {sources.length > 1 && (
          <p className="hero-meta">
            Source {srcIndex + 1}/{sources.length}
            {active?.label ? ` · ${active.label}` : ''}
          </p>
        )}

        <div className="sama-video-wrap">
          <VideoPlayer
            src={playUrl}
            title={title}
            loading={loading}
            isHls={stream?.type !== 'mp4'}
            autoPlay
            watchdogMs={watchdogMs}
            sourceLabel={active?.label}
            onFail={error ? undefined : nextSource}
          />
        </div>

        {error && (
          <div className="page-error">
            <p>{error}</p>
            <button
              type="button"
              className="section-tab mt-3"
              onClick={() => {
                if (!id) return;
                roundsRef.current = 0;
                switchingRef.current = false;
                setError(null);
                setLoading(true);
                void resolveStream(id)
                  .then((info) => {
                    setStream(info);
                    setSrcIndex(0);
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : 'Flux introuvable'))
                  .finally(() => setLoading(false));
              }}
            >
              Réessayer
            </button>
          </div>
        )}

        {sources.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {sources.map((source, index) => (
              <button
                key={source.playPath}
                type="button"
                className={`section-tab ${index === srcIndex ? 'active' : ''}`}
                onClick={() => {
                  setError(null);
                  switchingRef.current = false;
                  setSrcIndex(index);
                }}
              >
                {source.label || `Source ${index + 1}`}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          <Link to="/" className="section-desc">
            ← Retour aux chaînes
          </Link>
        </div>
      </section>

      {related.length > 0 && (
        <section className="section max-w-[1440px] mx-auto px-4 py-7 sm:px-6">
          <div className="section-head">
            <h2>Autres chaînes {current?.category || ''}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {related.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
