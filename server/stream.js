import https from 'https';
import http from 'http';
import { randomBytes } from 'crypto';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const STREAM_CACHE_VERSION = 'v7';

const TICKET_TTL_MS = 15 * 60 * 1000;
const SEGMENT_TTL_MS = 120 * 1000;
const MAX_CACHE_BYTES = 320 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
// Une seule connexion de préchargement : sur un lien étroit, tout téléchargement
// parallèle est pris sur le dos du segment que le lecteur attend.
const MAX_PARALLEL_FETCH = 1;
// Le lecteur démarre près du direct : seuls les derniers segments l'intéressent.
const PREFETCH_DEPTH = 2;
// Au-delà, le client se sert lui-même plutôt que d'attendre le préchargement.
const WAIT_FOR_PREFETCH_MS = 5000;
const MAX_QUEUE = 8;
const JOB_STALE_MS = 20000;
const PLAYLIST_TTL_MS = 1500;
const POLL_IDLE_MS = 90 * 1000;

// On ferme chaque connexion volontairement (voir proxyHeaders) : mutualiser les
// sockets ne ferait que créer une file d'attente invisible côté agent.
const agentOptions = { keepAlive: false, maxSockets: 32 };
const httpsAgent = new https.Agent(agentOptions);
const httpAgent = new http.Agent(agentOptions);

const tickets = new Map();
const ticketsByUrl = new Map();

const segmentCache = new Map();
const pendingFetches = new Map();
const playlistCache = new Map();
const playlistProfiles = new Map();
const pollers = new Map();
const fetchQueue = [];
let cacheBytes = 0;
let activeFetches = 0;
let activeClientStreams = 0;

function pruneTickets() {
  const now = Date.now();
  for (const [id, ticket] of tickets) {
    if (ticket.exp < now) {
      tickets.delete(id);
      if (ticketsByUrl.get(ticket.url) === id) ticketsByUrl.delete(ticket.url);
    }
  }
}

export function registerProxyTarget(url, referer) {
  pruneTickets();
  const existingId = ticketsByUrl.get(url);
  const existing = existingId ? tickets.get(existingId) : null;
  if (existing && existing.exp > Date.now()) {
    existing.exp = Date.now() + TICKET_TTL_MS;
    if (referer) existing.referer = referer;
    return existingId;
  }

  const id = randomBytes(8).toString('hex');
  tickets.set(id, { url, referer: referer || 'https://fstv.rest/', exp: Date.now() + TICKET_TTL_MS });
  ticketsByUrl.set(url, id);
  return id;
}

export function getStats() {
  return {
    version: STREAM_CACHE_VERSION,
    tickets: tickets.size,
    segmentsEnCache: segmentCache.size,
    memoireCacheMo: Math.round(cacheBytes / (1024 * 1024)),
    telechargementsEnCours: activeFetches,
    fileDAttente: fetchQueue.length,
    prechargementsEnVol: pendingFetches.size,
    playlistsSuivies: pollers.size,
    segmentsClientEnCours: activeClientStreams,
    playlistsAJetonUnique: [...playlistProfiles.values()].filter((p) => p.state === 'volatile')
      .length,
  };
}

export function getTicket(id) {
  const ticket = tickets.get(id);
  if (!ticket || ticket.exp < Date.now()) return null;
  ticket.exp = Date.now() + TICKET_TTL_MS;
  return ticket;
}

function proxyHeaders(referer) {
  return {
    'User-Agent': USER_AGENT,
    Referer: referer || 'https://fstv.rest/',
    Origin: 'https://fstv.rest',
    Accept: '*/*',
    // Sans cela certaines sources gardent la connexion ouverte après le corps :
    // la fin de réponse n'arrive jamais et le lecteur attend indéfiniment.
    Connection: 'close',
  };
}

function looksLikePlaylist(chunk) {
  return Boolean(chunk) && chunk.toString('utf8', 0, 16).includes('#EXTM3U');
}

function evictCache() {
  const now = Date.now();
  for (const [url, entry] of segmentCache) {
    if (entry.exp < now) {
      segmentCache.delete(url);
      cacheBytes -= entry.buf.length;
    }
  }
  for (const [url, entry] of playlistCache) {
    if (entry.exp + POLL_IDLE_MS < now) playlistCache.delete(url);
  }
  for (const [url, profile] of playlistProfiles) {
    if (now - profile.seen > 10 * 60 * 1000) playlistProfiles.delete(url);
  }
  // Map preserves insertion order, so the first entries are the oldest.
  for (const [url, entry] of segmentCache) {
    if (cacheBytes <= MAX_CACHE_BYTES) break;
    segmentCache.delete(url);
    cacheBytes -= entry.buf.length;
  }
}

function storeSegment(url, buf, contentType) {
  if (!buf.length || buf.length > MAX_SEGMENT_BYTES || looksLikePlaylist(buf)) return;
  const previous = segmentCache.get(url);
  if (previous) cacheBytes -= previous.buf.length;
  segmentCache.set(url, { buf, contentType: contentType || 'video/MP2T', exp: Date.now() + SEGMENT_TTL_MS });
  cacheBytes += buf.length;
  evictCache();
}

function readSegment(url) {
  const entry = segmentCache.get(url);
  if (!entry) return null;
  if (entry.exp < Date.now()) {
    segmentCache.delete(url);
    cacheBytes -= entry.buf.length;
    return null;
  }
  entry.exp = Date.now() + SEGMENT_TTL_MS;
  return entry;
}

function fetchBuffer(url, referer, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    let done = false;
    let idleTimer;

    // Sans échéance absolue, une requête en attente de socket peut ne jamais
    // se dénouer et bloquer définitivement la file de préchargement.
    const deadline = setTimeout(() => {
      settle(new Error('Échéance dépassée'));
    }, timeout);

    function settle(err, value) {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      clearTimeout(idleTimer);
      req.destroy();
      if (err) reject(err);
      else resolve(value);
    }

    const req = lib.request(
      parsed,
      {
        method: 'GET',
        agent: parsed.protocol === 'https:' ? httpsAgent : httpAgent,
        headers: proxyHeaders(referer),
        timeout,
      },
      (upstream) => {
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
          upstream.resume();
          if (done) return;
          done = true;
          clearTimeout(deadline);
          clearTimeout(idleTimer);
          req.destroy();
          fetchBuffer(new URL(upstream.headers.location, url).href, referer, timeout).then(
            resolve,
            reject,
          );
          return;
        }
        if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
          upstream.resume();
          settle(new Error(`HTTP ${upstream.statusCode}`));
          return;
        }

        const contentType = upstream.headers['content-type'] || '';
        const expected = Number(upstream.headers['content-length']) || 0;
        const chunks = [];
        let received = 0;
        let playlist = null;

        const finish = () => settle(null, { buf: Buffer.concat(chunks), contentType });

        upstream.on('data', (chunk) => {
          if (playlist === null) {
            playlist = looksLikePlaylist(chunk) || contentType.includes('mpegurl');
          }
          chunks.push(chunk);
          received += chunk.length;

          // Le corps est complet : inutile d'attendre la fermeture keep-alive.
          if (expected && received >= expected) {
            finish();
            return;
          }
          // Les playlists restent ouvertes en amont, on les clôt sur inactivité.
          if (playlist) {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(finish, 250);
          }
        });
        upstream.on('end', finish);
        upstream.on('error', (err) => settle(err));
      },
    );

    req.on('timeout', () => settle(new Error('Timeout source')));
    req.on('error', (err) => settle(err));
    req.end();
  });
}

function dropJob(job) {
  pendingFetches.delete(job.url);
  job.release(null);
}

function runQueue() {
  // Un segment réclamé par le lecteur passe avant tout : sur une liaison
  // étroite, précharger en parallèle ne ferait que ralentir la lecture.
  if (activeClientStreams > 0) return;

  while (activeFetches < MAX_PARALLEL_FETCH && fetchQueue.length) {
    const job = fetchQueue.shift();
    // Un segment resté trop longtemps en file est déjà hors du direct.
    if (Date.now() - job.queuedAt > JOB_STALE_MS) {
      dropJob(job);
      continue;
    }
    activeFetches += 1;
    job.run().finally(() => {
      activeFetches -= 1;
      runQueue();
    });
  }
}

function prefetchSegment(url, referer) {
  if (readSegment(url) || pendingFetches.has(url)) return pendingFetches.get(url) || null;

  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  pendingFetches.set(url, promise);

  const job = {
    url,
    release,
    queuedAt: Date.now(),
    run: async () => {
      try {
        const { buf, contentType } = await fetchBuffer(url, referer);
        storeSegment(url, buf, contentType);
        release({ buf, contentType });
      } catch {
        release(null);
      } finally {
        pendingFetches.delete(url);
      }
    },
  };

  fetchQueue.push(job);
  // La file ne doit jamais enfler : les segments récents priment sur les vieux.
  while (fetchQueue.length > MAX_QUEUE) dropJob(fetchQueue.shift());
  runQueue();

  return promise;
}

function schedulePrefetch(urls, referer) {
  urls.forEach((url) => prefetchSegment(url, referer));
}

// Certaines chaînes signent chaque segment d'un jeton à usage unique : les URLs
// changent à chaque rafraîchissement, donc précharger ne sert à rien et vole de
// la bande passante au lecteur. On le détecte et on repasse en simple relais.
function trackPlaylist(playlistUrl, segmentUrls) {
  const profile = playlistProfiles.get(playlistUrl) || { state: 'inconnu', last: null };
  profile.seen = Date.now();

  if (profile.last && profile.last.size && segmentUrls.length) {
    const overlap = segmentUrls.filter((url) => profile.last.has(url)).length;
    profile.state = overlap === 0 ? 'volatile' : 'stable';
  }
  profile.last = new Set(segmentUrls);
  playlistProfiles.set(playlistUrl, profile);

  return profile.state;
}

function stopPoller(playlistUrl) {
  const poller = pollers.get(playlistUrl);
  if (!poller) return;
  clearInterval(poller.timer);
  pollers.delete(playlistUrl);
}

function toProxyUrl(rawUrl, base, referer) {
  const absolute = rawUrl.startsWith('http') ? rawUrl : new URL(rawUrl, base).href;
  return `/api/p/${registerProxyTarget(absolute, referer)}`;
}

function rewriteM3u8(body, targetUrl, referer, fromPoller = false) {
  const cut = targetUrl.split('?')[0];
  const base = cut.substring(0, cut.lastIndexOf('/') + 1);
  const segmentUrls = [];

  const rewritten = body
    .split('\n')
    .map((line) => {
      if (line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${toProxyUrl(uri, base, referer)}"`);
      }
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const absolute = trimmed.startsWith('http') ? trimmed : new URL(trimmed, base).href;
      segmentUrls.push(absolute);
      return toProxyUrl(trimmed, base, referer);
    })
    .join('\n');

  const state = trackPlaylist(targetUrl, segmentUrls);
  if (state === 'volatile') {
    stopPoller(targetUrl);
    playlistCache.delete(targetUrl);
  } else {
    // Tant que la stabilité des URLs n'est pas confirmée, on ne précharge rien :
    // ce serait du téléchargement pur perte sur une chaîne à jetons uniques.
    if (state === 'stable') schedulePrefetch(segmentUrls.slice(-PREFETCH_DEPTH), referer);
    ensurePoller(targetUrl, referer, body, fromPoller);
  }

  return rewritten;
}

function isVolatilePlaylist(url) {
  return playlistProfiles.get(url)?.state === 'volatile';
}

function ensurePoller(playlistUrl, referer, body, fromPoller) {
  const existing = pollers.get(playlistUrl);
  if (existing) {
    if (!fromPoller) existing.lastAccess = Date.now();
    return;
  }
  if (fromPoller) return;

  const target = Number(body.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1]) || 10;
  if (!/#EXTINF/.test(body)) return;

  const interval = Math.min(5000, Math.max(2000, Math.round((target * 1000) / 3)));
  const entry = { lastAccess: Date.now(), busy: false, timer: null, interval };

  entry.timer = setInterval(async () => {
    if (Date.now() - entry.lastAccess > POLL_IDLE_MS) {
      clearInterval(entry.timer);
      pollers.delete(playlistUrl);
      return;
    }
    if (entry.busy) return;
    entry.busy = true;
    try {
      const { buf } = await fetchBuffer(playlistUrl, referer, 20000);
      const text = buf.toString('utf8');
      if (text.includes('#EXTM3U')) {
        playlistCache.set(playlistUrl, {
          body: rewriteM3u8(text, playlistUrl, referer, true),
          exp: playlistExpiry(playlistUrl),
        });
      }
    } catch {
      /* le prochain tick réessaiera */
    } finally {
      entry.busy = false;
    }
  }, interval);

  if (entry.timer.unref) entry.timer.unref();
  pollers.set(playlistUrl, entry);
}

function playlistExpiry(playlistUrl) {
  const poller = pollers.get(playlistUrl);
  // Tant qu'un poller rafraîchit la playlist, on peut servir sa copie sans aller en amont.
  return Date.now() + (poller ? poller.interval + 1000 : PLAYLIST_TTL_MS);
}

function sendPlaylistBody(res, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(body);
}

function sendSegmentBuffer(res, entry) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', entry.contentType || 'video/MP2T');
  res.setHeader('Content-Length', entry.buf.length);
  res.setHeader('Cache-Control', 'public, max-age=90');
  res.end(entry.buf);
}

function isPlaylistType(contentType, firstChunk) {
  if (firstChunk && firstChunk[0] === 0x47) return false;
  if (looksLikePlaylist(firstChunk)) return true;
  const type = contentType || '';
  return type.includes('mpegurl') || type.includes('x-mpegURL');
}

export function proxyToResponse(targetUrl, referer, res) {
  const cachedSegment = readSegment(targetUrl);
  if (cachedSegment) {
    sendSegmentBuffer(res, cachedSegment);
    return;
  }

  const cachedPlaylist = playlistCache.get(targetUrl);
  if (cachedPlaylist && cachedPlaylist.exp > Date.now() && !isVolatilePlaylist(targetUrl)) {
    const poller = pollers.get(targetUrl);
    if (poller) poller.lastAccess = Date.now();
    sendPlaylistBody(res, cachedPlaylist.body);
    return;
  }

  const inFlight = pendingFetches.get(targetUrl);
  if (inFlight) {
    let handled = false;
    const takeOver = () => {
      if (handled || res.headersSent || res.writableEnded) return;
      handled = true;
      streamFromUpstream(targetUrl, referer, res);
    };
    // Le préchargement est un bonus, jamais une dépendance : s'il tarde,
    // le client va chercher le segment lui-même.
    const giveUp = setTimeout(takeOver, WAIT_FOR_PREFETCH_MS);

    inFlight.then((result) => {
      clearTimeout(giveUp);
      if (handled || res.headersSent || res.writableEnded) return;
      handled = true;
      const entry = readSegment(targetUrl);
      if (entry) sendSegmentBuffer(res, entry);
      else if (result && !looksLikePlaylist(result.buf)) sendSegmentBuffer(res, result);
      else streamFromUpstream(targetUrl, referer, res);
    });
    return;
  }

  streamFromUpstream(targetUrl, referer, res);
}

function streamFromUpstream(targetUrl, referer, res) {
  const parsed = new URL(targetUrl);
  const lib = parsed.protocol === 'https:' ? https : http;
  let settled = false;

  const fail = (status, message) => {
    if (settled || res.headersSent) return;
    settled = true;
    res.status(status).json({ error: message });
  };

  const req = lib.request(
    parsed,
    {
      method: 'GET',
      agent: parsed.protocol === 'https:' ? httpsAgent : httpAgent,
      headers: proxyHeaders(referer),
      timeout: 90000,
    },
    (upstream) => {
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        upstream.resume();
        streamFromUpstream(new URL(upstream.headers.location, targetUrl).href, referer, res);
        return;
      }

      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        upstream.resume();
        fail(502, `Proxy error ${upstream.statusCode}`);
        return;
      }

      const contentType = upstream.headers['content-type'] || '';
      const expected = Number(upstream.headers['content-length']) || 0;
      const chunks = [];
      let mode = null;
      let idleTimer;
      let received = 0;

      let binaryDone = false;
      let holdsClientSlot = false;
      let hardStop;

      const releaseClientSlot = () => {
        if (!holdsClientSlot) return;
        holdsClientSlot = false;
        activeClientStreams -= 1;
        runQueue();
      };

      const finishBinary = () => {
        if (binaryDone) return;
        binaryDone = true;
        releaseClientSlot();
        clearTimeout(idleTimer);
        clearTimeout(hardStop);
        // Un corps tronqué ne doit pas polluer le cache.
        if (!expected || received >= expected) {
          storeSegment(targetUrl, Buffer.concat(chunks), contentType);
        }
        res.end();
        upstream.destroy();
      };

      const sendPlaylist = () => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = rewriteM3u8(raw, targetUrl, referer);
        if (!isVolatilePlaylist(targetUrl)) {
          playlistCache.set(targetUrl, { body, exp: playlistExpiry(targetUrl) });
        }
        sendPlaylistBody(res, body);
        upstream.destroy();
      };

      upstream.on('data', (chunk) => {
        if (!mode) {
          mode = isPlaylistType(contentType, chunk) ? 'playlist' : 'binary';
          if (mode === 'binary') {
            settled = true;
            holdsClientSlot = true;
            activeClientStreams += 1;
            res.once('close', releaseClientSlot);
            // Un client parti sans fermer proprement laisserait la connexion
            // ouverte à vie : passé ce délai le segment n'a plus d'intérêt.
            hardStop = setTimeout(finishBinary, 75000);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', contentType || 'video/MP2T');
            if (upstream.headers['content-length']) {
              res.setHeader('Content-Length', upstream.headers['content-length']);
            }
            res.setHeader('Cache-Control', 'public, max-age=90');
          }
        }

        chunks.push(chunk);

        if (mode === 'binary') {
          received += chunk.length;
          if (!res.write(chunk)) {
            upstream.pause();
            res.once('drain', () => upstream.resume());
          }
          // Le corps annoncé est complet : on clôt sans attendre la source.
          if (expected && received >= expected) {
            finishBinary();
            return;
          }
          clearTimeout(idleTimer);
          idleTimer = setTimeout(finishBinary, 8000);
          return;
        }
        clearTimeout(idleTimer);
        idleTimer = setTimeout(sendPlaylist, 250);
      });

      upstream.on('end', () => {
        if (mode === 'playlist') {
          sendPlaylist();
          return;
        }
        if (mode === 'binary') {
          finishBinary();
          return;
        }
        // Réponse vide : sans cela la requête resterait suspendue côté client.
        fail(502, 'Réponse vide de la source');
      });

      upstream.on('error', () => {
        releaseClientSlot();
        clearTimeout(idleTimer);
        if (res.headersSent) res.end();
        else fail(502, 'Flux coupé');
      });
    },
  );

  req.on('timeout', () => {
    req.destroy();
    fail(504, 'Timeout source');
  });
  req.on('error', () => fail(502, 'Source inaccessible'));
  req.end();
}
