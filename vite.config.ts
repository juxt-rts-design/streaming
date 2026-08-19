import os from 'node:os';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Adresses locales de la machine, pour ouvrir l'app depuis un téléphone du même Wi-Fi.
const lanHosts = Object.values(os.networkInterfaces())
  .flat()
  .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
  .map((iface) => iface!.address);

// Les tunnels (cloudflared, ngrok…) servent l'app sur un domaine public en HTTPS :
// Vite doit accepter ce Host et le client HMR doit viser le port 443 du tunnel.
const allowedHosts = [
  'localhost',
  '127.0.0.1',
  '.trycloudflare.com',
  '.ngrok-free.app',
  ...lanHosts,
];
const behindTunnel = process.env.CINELAB_TUNNEL === '1';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5175,
    strictPort: true,
    allowedHosts,
    hmr: behindTunnel ? { protocol: 'wss', clientPort: 443 } : true,
    proxy: {
      '/api': {
        target: 'http://localhost:3040',
        changeOrigin: true,
        timeout: 180000,
        proxyTimeout: 180000,
      },
    },
  },
  preview: {
    host: true,
    port: 5175,
    allowedHosts,
  },
  build: {
    outDir: 'dist',
  },
});
