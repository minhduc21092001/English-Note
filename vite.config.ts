import { defineConfig } from 'vite';

// Builds the admin editor (admin/index.html) into dist/admin/.
// Files in public/ are copied to dist/ and served by the Worker as static assets.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: 'admin/index.html' },
  },
  server: {
    proxy: { '/api': 'http://localhost:8787', '/media': 'http://localhost:8787' },
  },
});
