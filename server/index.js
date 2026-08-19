import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { cached, clearAll } from './cache.js';
import { CATEGORIES, getChannels, resolveChannelStream } from './channels.js';
import {
  STREAM_CACHE_VERSION,
  registerProxyTarget,
  getTicket,
  getStats,
  proxyToResponse,
} from './stream.js';

clearAll();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3040;
const HOST = process.env.HOST || '127.0.0.1';

const TTL = {
  channels: 1000 * 60 * 5,
  stream: 1000 * 60 * 2,
};

app.use(cors());
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ...getStats() });
});

app.get('/api/channels', async (req, res) => {
  try {
    const category = String(req.query.category || '').trim();
    const query = String(req.query.q || '').trim().toLowerCase();
    let channels = await cached('channels', TTL.channels, getChannels);

    if (category && category !== 'all') {
      channels = channels.filter((ch) => ch.category === category);
    }
    if (query) {
      channels = channels.filter((ch) => ch.name.toLowerCase().includes(query));
    }

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ channels, categories: CATEGORIES });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stream/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'ID invalide' });
    }

    const stream = await cached(`stream:${id}`, TTL.stream, () => resolveChannelStream(id));
    const sources = (stream.sources || [{ url: stream.url, label: 'Par défaut', kind: 'default' }]).map(
      (source) => ({
        ...source,
        playPath: `/api/p/${registerProxyTarget(source.url, stream.referer)}`,
      }),
    );
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({
      ...stream,
      sources,
      playPath: sources[0]?.playPath,
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get('/api/p/:id', (req, res) => {
  const ticket = getTicket(req.params.id);
  if (!ticket) {
    return res.status(410).json({ error: 'Flux expiré, recharge la page' });
  }
  proxyToResponse(ticket.url, ticket.referer, res);
});

// Exposé publiquement (tunnel), ce point d'entrée serait un proxy ouvert :
// on le limite à la source du catalogue, les segments passant par /api/p/:id.
const PROXY_ALLOWED_HOSTS = new Set(['fstv.rest', 'www.fstv.rest']);

app.get('/api/proxy', (req, res) => {
  const targetUrl = String(req.query.url || '');
  const referer = String(req.query.referer || 'https://fstv.rest/');

  let host;
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocole');
    host = parsed.hostname;
  } catch {
    return res.status(400).json({ error: 'URL invalide' });
  }

  if (!PROXY_ALLOWED_HOSTS.has(host)) {
    return res.status(403).json({ error: 'Domaine non autorisé' });
  }

  proxyToResponse(targetUrl, referer, res);
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  const indexFile = path.join(distPath, 'index.html');

  if (!existsSync(indexFile)) {
    console.error('dist/ introuvable : lance `npm run build` avant de démarrer en production.');
    process.exit(1);
  }

  // Les assets sont hashés donc cachables longtemps, mais index.html doit rester frais.
  app.use(express.static(distPath, { maxAge: '30d', immutable: true, index: false }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(indexFile);
  });
}

app.listen(PORT, HOST, () => {
  console.log(`CineLab API sur http://${HOST}:${PORT} (stream ${STREAM_CACHE_VERSION})`);
});
