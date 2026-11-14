import { defineConfig } from 'vite';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** Copia data/metrics.json (caché de la Action) al build para que la app la lea en Pages. */
function copyMetrics() {
  return {
    name: 'copy-metrics',
    apply: 'build',
    closeBundle() {
      mkdirSync('dist/data', { recursive: true });
      copyFileSync('data/metrics.json', 'dist/data/metrics.json');
    },
  };
}

export default defineConfig({
  base: '/gh1611-simLinPro/',
  plugins: [copyMetrics()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__: JSON.stringify((process.env.VITE_COMMIT_SHA || 'local').slice(0, 40)),
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/peerjs')) return 'peerjs';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
  },
});
