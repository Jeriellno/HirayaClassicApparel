import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// ==========================================
// ENVIRONMENT CONFIGURATION
// ==========================================
// Ensure this matches your actual Supabase project reference exactly.
// (Fixed the missing 'b' from 'qnysklxjfdsvncaehvh')
const SUPABASE_PROJECT_REF = 'qnysklbxfjdsvncaehvh';
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
const BACKEND_URL = 'http://127.0.0.1:8000';

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

    /*
     * CROSS-ORIGIN ISOLATION
     * These headers are required to expose SharedArrayBuffer to the browser.
     * The on-device segmentation model (onnxruntime-web) relies on this for
     * multi-threading. Without these, it falls back to single-thread and 
     * takes ~22s to process an image.
     */
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },

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
      // Bypasses COEP (Cross-Origin-Embedder-Policy) restrictions. 
      // Supabase does not send the `Cross-Origin-Resource-Policy` header, 
      // so direct image requests are blocked. Proxying makes them same-origin.
      '/supabase-storage': {
        target: SUPABASE_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase-storage/, ''),
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