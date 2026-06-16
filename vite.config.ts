import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST || "127.0.0.1";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __AUTORESEARCH_DEFAULT_WORKDIR__: JSON.stringify(process.env.AUTORESEARCH_DEFAULT_WORKDIR ?? null),
    __AUTORESEARCH_DEFAULT_EXPERIMENT_DIR__: JSON.stringify(process.env.AUTORESEARCH_DEFAULT_EXPERIMENT_DIR ?? null),
    __AUTORESEARCH_DEFAULT_METRIC__: JSON.stringify(process.env.AUTORESEARCH_DEFAULT_METRIC ?? null),
    __AUTORESEARCH_DEFAULT_DIRECTION__: JSON.stringify(process.env.AUTORESEARCH_DEFAULT_DIRECTION ?? null),
    __AUTORESEARCH_DEFAULT_ITERATIONS__: JSON.stringify(process.env.AUTORESEARCH_DEFAULT_ITERATIONS ?? null),
  },
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },

  // Path aliases
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Split heavy vendor libs into their own chunks so the main bundle stays lean
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // react-syntax-highlighter + prism grammars (~800 KB)
          'syntax-highlight': [
            'react-syntax-highlighter',
            'react-syntax-highlighter/dist/esm/styles/prism',
            'refractor',
          ],
          // react core (rarely changes → good cache hit)
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/.pipi-shrimp/**",
        "**/__tests__/.tmp/**",
        "**/.tmp/**"
      ],
    },
  },
}));
