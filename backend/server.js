import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3040;

// ============================================
// CONFIGURATION CORS RESTREINTE
// ============================================
const ALLOWED_ORIGINS = [
  'http://localhost:5500',      // Dev frontend (python http.server)
  'http://127.0.0.1:5500',
  'http://localhost:8081',      // Alternative si 5500 occupé
  'https://cinelab.vercel.app'  // Production (à changer)
];

app.use(cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origine (curl, Postman)
    if (!origin) return callback(null, true);
    
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origine non autorisée par CORS'));
    }
  },
  methods: ['GET'],
  credentials: false
}));

// ============================================
// SOURCE DES DONNÉES (fstv.rest)
// ============================================
const UPSTREAM = 'https://fstv.rest';
const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8'
};

const CATEGORY_LABELS = {
  generaliste: 'Généraliste',
  sport: 'Sport',
  cinema: 'Cinéma',
  enfants: 'Jeunesse',
  documentaire: 'Documentaire',
  information: 'Info',
  musique: 'Musique'
};

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseChannelsFromHtml(html) {
  const channels = [];
  const seen = new Set();
  let category = 'Généraliste';
  const tokenRe = /st-capt"[^>]*category=([a-z-]+)|newsid=(\d+)"\s+alt="([^"]+)"[\s\S]{0,1500}?src="([^"]+)"[\s\S]{0,500}?short-title">\s*([^<]+)/gi;

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
      logo
    });
  }

  return channels;
}

function parseStreamFromHtml(html) {
  const matches = [...html.matchAll(/window\.FSTV_SRC\s*=\s*"([^"]*)"/g)];
  const src = matches.map((item) => item[1]).filter(Boolean).at(-1);
  if (!src) return null;
  return src.startsWith('http') ? src : `${UPSTREAM}${src}`;
}

function parseNameFromHtml(html) {
  const match = html.match(/window\.FSTV_NAME\s*=\s*"([^"]*)"/);
  return match ? match[1] : null;
}

// ============================================
// ROUTE 1 : Liste des chaînes
// ============================================
app.get('/api/channels', async (_req, res) => {
  try {
    const response = await fetch(`${UPSTREAM}/index.php`, {
      headers: UPSTREAM_HEADERS
    });

    if (!response.ok) {
      return res.status(502).json({ 
        success: false, 
        error: 'Source indisponible',
        status: response.status 
      });
    }

    const text = await response.text();
    const json = parseJsonOrNull(text);
    const channels = Array.isArray(json?.channels)
      ? json.channels
      : parseChannelsFromHtml(text);

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    res.json({ success: true, channels });

  } catch (error) {
    console.error('Erreur API:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur interne' 
    });
  }
});

// ============================================
// ROUTE 2 : Détail d'une chaîne
// ============================================
app.get('/api/channel/:id', async (req, res) => {
  const { id } = req.params;
  
  // Validation : l'ID doit être un nombre
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID invalide' 
    });
  }

  try {
    const response = await fetch(`${UPSTREAM}/index.php?newsid=${id}`, {
      headers: UPSTREAM_HEADERS
    });

    if (!response.ok) {
      return res.status(502).json({ 
        success: false, 
        error: 'Chaîne introuvable' 
      });
    }

    const text = await response.text();
    const json = parseJsonOrNull(text);
    const streamUrl = json?.stream_url || json?.url || parseStreamFromHtml(text);
    const name = json?.name || parseNameFromHtml(text);

    if (!streamUrl) {
      return res.status(502).json({
        success: false,
        error: 'Flux non disponible'
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
    res.json({
      success: true,
      id,
      name,
      stream_url: streamUrl
    });

  } catch (error) {
    console.error('Erreur API:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur interne' 
    });
  }
});

// ============================================
// ROUTE 3 : Logos des chaînes (proxy d'images)
// ============================================
app.get('/api/logo/:filename', async (req, res) => {
  const { filename } = req.params;
  
  // Validation : pas de path traversal
  if (filename.includes('..') || filename.includes('/')) {
    return res.status(400).json({ error: 'Nom de fichier invalide' });
  }

  try {
    const response = await fetch(`${UPSTREAM}/chaineimg/${filename}`);

    if (!response.ok) {
      return res.status(404).json({ error: 'Logo introuvable' });
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/png';

    // Cache : 24h pour les images
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Content-Type', contentType);
    res.send(Buffer.from(buffer));

  } catch (error) {
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// ============================================
// ROUTE 4 : Santé de l'API
// ============================================
app.get('/api/health', (_req, res) => {
  res.json({ 
    success: true, 
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// ============================================
// DÉMARRAGE
// ============================================
app.listen(PORT, () => {
  console.log(`✅ CineLab Backend démarré sur http://localhost:${PORT}`);
});
