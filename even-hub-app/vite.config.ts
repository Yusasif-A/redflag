import { defineConfig } from 'vite';

export default defineConfig({
  // The phone and the simulator both load the app over the LAN, so bind wide.
  server: { host: true, port: 5180, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', assetsDir: 'assets' },
  // Relative base so the packaged bundle works wherever Even Hub mounts it.
  base: './',
});
