import { networkInterfaces } from 'node:os';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// First non-internal IPv4 address, so the dev-mode QR code points the phone
// at this computer instead of "localhost".
function lanHost(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
}

export default defineConfig(({ command }) => ({
  // Relative base so the build works under a GitHub Pages project subpath.
  base: './',
  build: { target: 'es2022' },
  // Self-signed HTTPS in dev: phones only expose motion sensors over HTTPS.
  plugins: command === 'serve' ? [basicSsl()] : [],
  server: { host: true },
  define: {
    __LAN_HOST__: JSON.stringify(command === 'serve' ? lanHost() : ''),
  },
}));
