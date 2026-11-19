import { defineConfig } from 'vite';

// Builds the admin editor (admin/index.html) into dist/admin/.
// Files in public/ are copied to dist/ and served by the Worker as static assets.
export default defineConfig({
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  base: '/',
  build: {
    outDir: 'dist',
    // false: `wrangler dev` runs this build too and watches ./dist; wiping the folder confused its asset watcher.
    emptyOutDir: false,
    rollupOptions: {
      input: 'admin/index.html',
      // Stable names for the main script and stylesheet: a new hash on every build made the local dev server
      // keep serving the old files. (Lazy chunks and fonts keep hashed names.)
      output: {
        entryFileNames: 'assets/admin.js',
        assetFileNames: (info) => (info.names?.some((n) => n.endsWith('.css')) ? 'assets/admin.css' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:8787', '/media': 'http://localhost:8787' },
  },
});
