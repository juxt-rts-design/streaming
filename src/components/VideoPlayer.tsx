import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface Props {
  src: string;
  title: string;
  loading?: boolean;
  isHls?: boolean;
  autoPlay?: boolean;
  watchdogMs?: number;
  sourceLabel?: string;
  onFail?: () => void;
}

const MAX_RECONNECTS = 4;

export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(max-width: 820px)').matches ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  );
}

function tryPlay(video: HTMLVideoElement) {
  const play = video.play();
  if (play && play.catch) {
    play.catch(() => {
      video.muted = true;
      void video.play().catch(() => {});
    });
  }
}

function bufferAhead(video: HTMLVideoElement) {
  const t = video.currentTime;
  const ranges = video.buffered;
  for (let i = 0; i < ranges.length; i += 1) {
    if (t >= ranges.start(i) - 0.35 && t <= ranges.end(i)) {
      return ranges.end(i) - t;
    }
  }
  if (ranges.length) return Math.max(0, ranges.end(ranges.length - 1) - t);
  return 0;
}

// Un téléphone n'encaisse pas les mêmes tampons qu'un PC : trop de mémoire
// tamponnée y provoque des erreurs média et donc des reconnexions en boucle.
function hlsConfig(mobile: boolean): Partial<Hls['config']> {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    progressive: true,
    liveSyncMode: 'buffered',
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: Infinity,
    liveDurationInfinity: true,
    liveSyncOnStallIncrease: 1,
    maxLiveSyncPlaybackRate: 1,
    startFragPrefetch: true,
    backBufferLength: mobile ? 10 : 30,
    maxBufferLength: mobile ? 40 : 90,
    maxMaxBufferLength: mobile ? 60 : 180,
    maxBufferSize: (mobile ? 40 : 150) * 1000 * 1000,
    maxBufferHole: 0.5,
    highBufferWatchdogPeriod: 2,
    nudgeMaxRetry: 5,
    capLevelToPlayerSize: mobile,
    startLevel: -1,
    testBandwidth: false,
    manifestLoadingMaxRetry: 4,
    manifestLoadingRetryDelay: 800,
    levelLoadingMaxRetry: 6,
    levelLoadingRetryDelay: 800,
    fragLoadingMaxRetry: 8,
    fragLoadingRetryDelay: 800,
    fragLoadingTimeOut: 90000,
    manifestLoadingTimeOut: 20000,
    levelLoadingTimeOut: 20000,
    xhrSetup(xhr: XMLHttpRequest) {
      xhr.timeout = 90000;
      xhr.withCredentials = false;
    },
  };
}

export default function VideoPlayer({
  src,
  title,
  loading,
  isHls = true,
  autoPlay = true,
  watchdogMs = 35000,
  sourceLabel,
  onFail,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const playedRef = useRef(false);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Préparation du flux…');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src || loading) return undefined;

    const mobile = isMobileDevice();
    let cancelled = false;
    let failed = false;
    let netFails = 0;
    let bufferedFrags = 0;
    playedRef.current = false;
    setReady(false);
    setStatus(sourceLabel ? `Source : ${sourceLabel}` : 'Connexion au flux…');

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const failOnce = () => {
      if (cancelled || failed || playedRef.current) return;
      failed = true;
      failRef.current?.();
    };

    const markReady = () => {
      if (cancelled || failed || playedRef.current) return;
      playedRef.current = true;
      setReady(true);
      setStatus('');
      if (autoPlay) tryPlay(video);
    };

    // Le serveur précharge les segments : inutile d'attendre un gros tampon
    // avant d'afficher l'image, dès que la lecture peut démarrer on y va.
    const maybeStart = () => {
      if (playedRef.current || cancelled || failed) return;
      if (video.readyState >= 3 || bufferedFrags >= 2 || bufferAhead(video) >= 8) {
        markReady();
      }
    };

    const useHls =
      isHls || src.includes('.m3u8') || src.includes('/api/p/') || src.includes('/api/proxy');
    const useMse = useHls && Hls.isSupported();

    if (useMse) {
      const hls = new Hls(hlsConfig(mobile));
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => tryPlay(video));
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        bufferedFrags += 1;
        maybeStart();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (cancelled || failed) return;
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          try {
            hls.startLoad();
          } catch {
            /* la reprise suivante s'en chargera */
          }
          return;
        }
        if (!data.fatal) return;
        if (playedRef.current) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        netFails += 1;
        if (netFails < MAX_RECONNECTS) {
          setStatus(`Reconnexion… (${netFails}/${MAX_RECONNECTS})`);
          window.setTimeout(() => {
            if (!cancelled && !failed && !playedRef.current) {
              try {
                hls.startLoad();
              } catch {
                failOnce();
              }
            }
          }, 1200);
          return;
        }
        failOnce();
      });
      hlsRef.current = hls;
    } else {
      // Safari iOS lit le HLS nativement : pas d'événements hls.js ici.
      video.src = src;
      video.load();
    }

    const onNativeError = () => failOnce();

    video.muted = true;
    video.addEventListener('playing', markReady);
    video.addEventListener('canplay', maybeStart);
    video.addEventListener('loadeddata', maybeStart);
    video.addEventListener('timeupdate', maybeStart);
    video.addEventListener('progress', maybeStart);
    if (!useMse) video.addEventListener('error', onNativeError);

    const watchdog = window.setTimeout(() => {
      if (!playedRef.current) failOnce();
    }, watchdogMs);

    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
      video.removeEventListener('playing', markReady);
      video.removeEventListener('canplay', maybeStart);
      video.removeEventListener('loadeddata', maybeStart);
      video.removeEventListener('timeupdate', maybeStart);
      video.removeEventListener('progress', maybeStart);
      video.removeEventListener('error', onNativeError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, loading, isHls, autoPlay, watchdogMs, sourceLabel]);

  return (
    <div className="player-wrapper">
      {(loading || (!ready && src)) && (
        <div className="player-buffer">
          <div className="spinner" />
          <p>{loading ? 'Chargement du flux...' : status || 'Préparation du flux…'}</p>
        </div>
      )}
      <video
        ref={videoRef}
        title={title}
        controls
        autoPlay={autoPlay}
        muted
        playsInline
        preload="auto"
        className={`native-player ${ready ? 'ready' : ''}`}
      />
    </div>
  );
}
