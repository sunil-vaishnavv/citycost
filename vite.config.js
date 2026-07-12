import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Port/HMR for `npm run dev` are controlled by Express in server.ts
  // (middlewareMode + shared HTTP server). Do not set strictPort here.
  server: {
    host: true,
  },
  build: {
    outDir: 'dist',
    // Source maps off in shipped artifacts (safer for public hosts).
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          lucide: ['lucide-react'],
        },
      },
    },
  },
});
