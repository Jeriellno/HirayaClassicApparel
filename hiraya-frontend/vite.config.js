import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// ==========================================
// ENVIRONMENT CONFIGURATION
// ==========================================
/*
 * THESE MUST MATCH .env EXACTLY. They did not, and it broke the image proxy.
 *
 * This file used to hardcode `qnysklbxfjdsvncaehvh` (with an extra `b`, under a
 * comment claiming it "fixed" a missing letter) while `.env` says
 * `qnyskltxjfdsvncaehvh`. Only the `.env` project actually exists — verified:
 *
 *   qnysklbxfjdsvncaehvh.supabase.co -> DNS does not resolve
 *   qnyskltxjfdsvncaehvh.supabase.co -> 200
 *
 * So the `/supabase-storage` dev proxy was pointed at a host that does not exist,
 * and every proxied image answered 500 instead of loading. Deriving them from the
 * SAME source (the env var) is the only way they can never drift apart again.
 *
 * Only `SUPABASE_URL` is used below, by the `/supabase-storage` dev-server proxy.
 * With COEP now removed (see the header comment in `server` below) that proxy is
 * optional, and the app can be pointed straight at the bucket with
 * `VITE_SUPABASE_URL` — but if it IS used it must target a real host.
 */
const BACKEND_URL = 'http://127.0.0.1:8000';
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  'https://qnyskltxjfdsvncaehvh.supabase.co';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  optimizeDeps: {
    exclude: ['@imgly/background-removal'],
    include: [
      'onnxruntime-web', 
      '@react-three/fiber', 
      '@react-three/drei', 
      'three'
    ],
  },

  server: {
    port: 5173,
    strictPort: true,

    /*
     * NO Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy.
     *
     * REMOVED ON PURPOSE — DO NOT ADD THEM BACK WITHOUT READING THIS.
     * ------------------------------------------------------------------
     * These two headers make the document "cross-origin isolated", which is the
     * only way the browser will expose `SharedArrayBuffer` — the thing
     * `onnxruntime-web` needs to run its WASM threads.
     *
     * WITH them, the on-device person-segmentation mask runs multi-threaded and
     * takes ~6s. WITHOUT them it is single-threaded and takes ~22s.
     *
     * That speed was not worth what `require-corp` cost. `require-corp` makes EVERY
     * cross-origin subresource opt in — via `Cross-Origin-Resource-Policy` or by
     * being fetched as CORS — and Supabase Storage does neither for a plain
     * `<img src>`. Supabase is a SaaS host we do not control, so we cannot add the
     * header on their side, and the result was every catalog image on Home, Shop,
     * Wishlist, Cart, Quick View and the Style Stack being blocked with
     *
     *   net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep
     *
     * The images matter more than the 16 seconds, so isolation is gone and we eat
     * the ~22s. That is the deliberate trade.
     *
     * WHAT THIS BUYS US: cross-origin images, fonts and CDN assets now just work,
     * with no proxy, no CORP header and no special-casing. The `/supabase-storage`
     * proxy below is kept anyway — see its comment for why.
     */

    proxy: {
      // 1. API Requests to Laravel Backend
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },

      // 2. Background-removal model assets (ONNX chunks)
      // Proxied to avoid CORS issues with PHP's built-in server.
      '/vendor/imgly': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },

      // 3. Supabase Storage Proxy
      //
      // KEPT EVEN THOUGH COEP IS GONE. It is no longer required to make images
      // render, but it still pays for itself:
      //   - it keeps the bucket host in ONE place (this file) instead of baked
      //     into every database row as an absolute URL;
      //   - it survives a future move to a different bucket/CDN with no data
      //     migration;
      //   - it avoids exposing the project ref in every image URL.
      // Set VITE_SUPABASE_STORAGE_PROXY=false to bypass it and hit Supabase directly.
      '/supabase-storage': {
        target: SUPABASE_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase-storage/, ''),
      },

      // 4. Laravel `public` disk (`/storage/...`)
      //
      // The catalog stores the backend's OWN uploads as
      // `http://127.0.0.1:8000/storage/catalog/x.png` (`Storage::disk('public')`
      // -> `url()`). `imageHelper.js` normalises those to a root-relative
      // `/storage/...` so they stay same-origin; without this proxy the SPA's own
      // dev server answered them, and because the backend runs as
      // `php -S ... public/index.php` (a router script that never statically
      // serves `public/storage`) every image came back 403 and every product
      // card rendered the "NO IMAGE" placeholder.
      '/storage': {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },
    },
  },

  build: {
    chunkSizeWarningLimit: 2000,
    commonjsOptions: {
      include: [/onnxruntime-web/, /node_modules/],
    },
  },
});