// ============================================
// CONFIGURATION
// ============================================
// En dev : http://localhost:3040
// En prod : https://cinelab-backend.vercel.app (à changer)
const API_BASE = 'http://localhost:3040';

let allChannels = [];
let currentCategory = 'all';
let hlsInstance = null;

// ============================================
// DOM REFS
// ============================================
const grid = document.getElementById('channelGrid');
const categoriesContainer = document.getElementById('categoriesContainer');
const searchInput = document.getElementById('searchInput');
const playerWrapper = document.getElementById('playerWrapper');
const video = document.getElementById('videoPlayer');
const closePlayerBtn = document.getElementById('closePlayer');
const playerOverlay = document.getElementById('playerOverlay');
const playerStatus = document.getElementById('playerStatus');
const playerTitle = document.getElementById('playerTitle');

const HLS_CONFIG = {
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 45,
    maxMaxBufferLength: 90,
    maxBufferSize: 100 * 1000 * 1000,
    maxBufferHole: 0.5,
    liveSyncDurationCount: 5,
    liveMaxLatencyDurationCount: 20,
    liveDurationInfinity: true,
    startLevel: -1,
    capLevelToPlayerSize: true,
    testBandwidth: true,
    abrEwmaDefaultEstimate: 2_000_000,
    abrBandWidthFactor: 0.85,
    abrBandWidthUpFactor: 0.6,
    nudgeMaxRetry: 8,
    manifestLoadingTimeOut: 15000,
    manifestLoadingMaxRetry: 6,
    levelLoadingTimeOut: 15000,
    levelLoadingMaxRetry: 6,
    fragLoadingTimeOut: 25000,
    fragLoadingMaxRetry: 8,
    fragLoadingRetryDelay: 800
};

function setPlayerStatus(message, show = true) {
    playerStatus.textContent = message;
    playerOverlay.classList.toggle('visible', show);
}

function destroyPlayer() {
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
}

function attachHls(streamUrl) {
    hlsInstance = new Hls(HLS_CONFIG);
    hlsInstance.loadSource(streamUrl);
    hlsInstance.attachMedia(video);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        setPlayerStatus('Buffer en cours…', true);
        video.play().catch(() => {});
    });

    hlsInstance.on(Hls.Events.FRAG_BUFFERED, () => {
        if (video.paused) {
            video.play().catch(() => {});
        }
    });

    hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
            if (data.details === 'bufferStalledError') {
                setPlayerStatus('Lissage du flux…', true);
            }
            return;
        }

        setPlayerStatus('Reconnexion au flux…', true);
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hlsInstance.startLoad();
            return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hlsInstance.recoverMediaError();
            return;
        }

        const src = hlsInstance.url;
        destroyPlayer();
        attachHls(src);
    });
}

// ============================================
// FETCH DES CHAÎNES
// ============================================
async function fetchChannels() {
    try {
        const res = await fetch(`${API_BASE}/api/channels`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        allChannels = data.channels || [];
        return allChannels;
    } catch (err) {
        console.error('Erreur fetch:', err);
        grid.innerHTML = '<p style="text-align:center;color:#FF6B6B;">Impossible de charger les chaînes. Vérifie que le backend tourne sur le port 3040.</p>';
        return [];
    }
}

// ============================================
// RENDU DES CHAÎNES
// ============================================
function renderChannels(channels) {
    if (!channels || channels.length === 0) {
        grid.innerHTML = '<p style="text-align:center;color:#666;">Aucune chaîne trouvée</p>';
        return;
    }

    let html = '';
    channels.forEach(ch => {
        // Utiliser le proxy de logos de NOTRE API
        const logoUrl = ch.logo 
            ? ch.logo.replace('https://fstv.rest/chaineimg/', `${API_BASE}/api/logo/`)
            : '';
        
        html += `
            <div class="channel-card" data-id="${ch.id}">
                ${logoUrl ? `<img src="${logoUrl}" alt="${ch.name}" loading="lazy" onerror="this.style.display='none'">` : '📺'}
                <div class="name">${ch.name}</div>
                <div class="category">${ch.category || 'Général'}</div>
            </div>
        `;
    });
    grid.innerHTML = html;

    // Clic sur une chaîne
    document.querySelectorAll('.channel-card').forEach(card => {
        card.addEventListener('click', () => playChannel(card.dataset.id));
    });
}

// ============================================
// RENDU DES CATÉGORIES
// ============================================
function renderCategories() {
    const categories = [...new Set(allChannels.map(ch => ch.category))].filter(Boolean);
    
    let html = `<button class="category-btn active" data-cat="all">Toutes</button>`;
    categories.forEach(cat => {
        html += `<button class="category-btn" data-cat="${cat}">${cat}</button>`;
    });
    categoriesContainer.innerHTML = html;

    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentCategory = btn.dataset.cat;
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilters();
        });
    });
}

// ============================================
// FILTRES
// ============================================
function applyFilters() {
    let filtered = allChannels;
    
    if (currentCategory !== 'all') {
        filtered = filtered.filter(ch => ch.category === currentCategory);
    }
    
    const query = searchInput.value.toLowerCase().trim();
    if (query) {
        filtered = filtered.filter(ch => ch.name.toLowerCase().includes(query));
    }
    
    renderChannels(filtered);
}

// ============================================
// LECTURE D'UNE CHAÎNE
// ============================================
async function playChannel(id) {
    try {
        const res = await fetch(`${API_BASE}/api/channel/${id}`);
        if (!res.ok) throw new Error('Chaîne introuvable');
        
        const data = await res.json();
        const streamUrl = data.stream_url || data.url;
        
        if (!streamUrl) throw new Error('Flux non disponible');

        playerTitle.textContent = data.name || 'CineLab';
        playerWrapper.classList.add('active');
        setPlayerStatus('Préparation du flux…', true);
        destroyPlayer();

        if (Hls.isSupported()) {
            attachHls(streamUrl);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.addEventListener('loadedmetadata', () => {
                video.play().catch(() => {});
            }, { once: true });
        } else {
            throw new Error('HLS non supporté');
        }
        
    } catch (err) {
        console.error('Erreur lecture:', err);
        setPlayerStatus('Impossible de lire cette chaîne', true);
    }
}

// ============================================
// FERMETURE DU PLAYER
// ============================================
video.addEventListener('waiting', () => setPlayerStatus('Buffer en cours…', true));
video.addEventListener('stalled', () => setPlayerStatus('Reprise du flux…', true));
video.addEventListener('playing', () => setPlayerStatus('', false));
video.addEventListener('canplay', () => {
    if (!video.paused) setPlayerStatus('', false);
});

closePlayerBtn.addEventListener('click', () => {
    playerWrapper.classList.remove('active');
    setPlayerStatus('', false);
    destroyPlayer();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePlayerBtn.click();
    }
});

// ============================================
// RECHERCHE EN TEMPS RÉEL
// ============================================
searchInput.addEventListener('input', applyFilters);

// ============================================
// INITIALISATION
// ============================================
async function init() {
    console.log('🚀 CineLab - Démarrage');
    const channels = await fetchChannels();
    if (channels.length > 0) {
        renderCategories();
        renderChannels(channels);
        return;
    }
    if (!grid.innerHTML.includes('Impossible de charger')) {
        grid.innerHTML = '<p style="text-align:center;color:#666;">Aucune chaîne trouvée</p>';
    }
}

init();
