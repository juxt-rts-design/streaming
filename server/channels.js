import https from 'https';

const UPSTREAM = 'https://fstv.rest';

export const UPSTREAM_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  Referer: `${UPSTREAM}/`,
};

const CATEGORY_LABELS = {
  generaliste: 'Généraliste',
  sport: 'Sport',
  cinema: 'Cinéma',
  enfants: 'Jeunesse',
  documentaire: 'Documentaire',
  information: 'Info',
  musique: 'Musique',
};

export const CATEGORIES = ['Généraliste', 'Sport', 'Cinéma', 'Jeunesse', 'Documentaire', 'Info', 'Musique'];

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function httpsGetText(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    };

    const req = https.get(url, { headers: UPSTREAM_HEADERS, timeout }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        done(new Error(`Source indisponible (${res.statusCode})`));
        return;
      }
      const chunks = [];
      let idle;
      const finish = () => done(null, Buffer.concat(chunks).toString('utf8'));
      res.on('data', (chunk) => {
        chunks.push(chunk);
        clearTimeout(idle);
        idle = setTimeout(finish, 450);
      });
      res.on('end', finish);
      res.on('error', (err) => done(err));
    });
    req.on('timeout', () => {
      req.destroy();
      done(new Error('Timeout source'));
    });
    req.on('error', (err) => done(err));
  });
}

export function parseChannelsFromHtml(html) {
  const channels = [];
  const seen = new Set();
  let category = 'Généraliste';
  const tokenRe =
    /st-capt"[^>]*category=([a-z-]+)|newsid=(\d+)"\s+alt="([^"]+)"[\s\S]{0,1500}?src="([^"]+)"[\s\S]{0,500}?short-title">\s*([^<]+)/gi;

  let match;
  while ((match = tokenRe.exec(html)) !== null) {
    if (match[1]) {
      category = CATEGORY_LABELS[match[1]] || match[1];
      continue;
    }

    const id = match[2];
    if (seen.has(id)) continue;
    seen.add(id);

    const src = match[4];
    const logo = src.startsWith('http') ? src : `${UPSTREAM}${src}`;

    channels.push({
      id,
      name: match[5].trim(),
      category,
      logo,
    });
  }

  return channels;
}

export function parseStreamFromHtml(html) {
  const matches = [...html.matchAll(/window\.FSTV_SRC\s*=\s*"([^"]*)"/g)]
    .map((item) => item[1].replace(/&amp;/g, '&').trim())
    .filter(Boolean);
  const preferred = matches.find((src) => /[?&]dl=/.test(src)) || matches.at(-1);
  if (!preferred) return null;
  return preferred.startsWith('http') ? preferred : `${UPSTREAM}${preferred}`;
}

export function parseNameFromHtml(html) {
  const match = html.match(/window\.FSTV_NAME\s*=\s*"([^"]*)"/);
  return match ? match[1] : null;
}

function sourceLabel(item) {
  const mapType = { basic: 'TNT', satellite: 'Sat', cable: 'Cable' };
  const parts = [item.q, mapType[item.s] || item.s].filter((part) => part && part !== 'None');
  return parts.join(' ') || 'Source';
}

// Poids indicatif du débit, pour démarrer sur une source légère au mobile.
function sourceWeight(label) {
  const upper = String(label || '').toUpperCase();
  if (upper.includes('4K') || upper.includes('UHD')) return 4;
  if (upper.includes('FHD')) return 3;
  if (upper.includes('HD')) return 2;
  return 1;
}

async function fetchAlternateSources(name) {
  if (!name) return [];
  try {
    const text = await httpsGetText(
      `${UPSTREAM}/live.php?q=1&sources=${encodeURIComponent(name)}`,
    );
    const data = parseJsonOrNull(text);
    if (!Array.isArray(data)) return [];
    return data
      .map((item) => {
        const sid = typeof item === 'string' ? item : item?.id;
        if (!sid) return null;
        const label = typeof item === 'object' ? sourceLabel(item) : 'Source';
        return {
          url: `${UPSTREAM}/live.php?id=${sid}`,
          label,
          kind: 'alt',
          weight: sourceWeight(label),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function getChannels() {
  const text = await httpsGetText(`${UPSTREAM}/index.php`);
  const json = parseJsonOrNull(text);
  if (Array.isArray(json?.channels) && json.channels.length) {
    return json.channels;
  }
  return parseChannelsFromHtml(text);
}

export async function resolveChannelStream(id) {
  const text = await httpsGetText(`${UPSTREAM}/index.php?newsid=${id}`);
  const json = parseJsonOrNull(text);
  const name = json?.name || parseNameFromHtml(text);
  const primary = json?.stream_url || json?.url || parseStreamFromHtml(text);

  if (!primary) {
    throw new Error('Flux direct introuvable');
  }

  const alts = await fetchAlternateSources(name);
  const seen = new Set();
  const sources = [];

  const push = (source) => {
    if (!source?.url || seen.has(source.url)) return;
    seen.add(source.url);
    sources.push(source);
  };

  push({
    url: primary,
    label: /[?&]dl=/.test(primary) ? 'Par défaut' : 'Source 1',
    kind: 'default',
    // La source premium est du 1080p50 : lourde pour un mobile.
    weight: /[?&]dl=/.test(primary) ? 3 : 2,
  });
  alts.forEach(push);

  return {
    id,
    name,
    url: primary,
    type: 'hls',
    referer: `${UPSTREAM}/`,
    sources,
  };
}
