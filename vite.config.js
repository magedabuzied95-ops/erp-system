import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname);
const indexHtml = path.resolve(projectRoot, "index.html");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  const buildVersion = String(
    env.VERCEL_GIT_COMMIT_SHA ||
    env.GITHUB_SHA ||
    env.SOURCE_VERSION ||
    Date.now()
  ).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12);
  const devProxyTarget = String(
    env.VITE_DEV_PROXY_TARGET ||
    env.VITE_API_PROXY_TARGET ||
    env.API_PROXY_TARGET ||
    env.VITE_API_URL ||
    ""
  ).trim().replace(/\/+$/, "");
  const devServerHost = String(env.VITE_DEV_SERVER_HOST || "").trim() || undefined;
  const proxy = devProxyTarget
    ? {
        "/api": {
          target: devProxyTarget,
          changeOrigin: true,
          secure: false,
          headers: {
            Origin: "https://erp.m1store-egy.com",
          },
        },
        "/uploads": {
          target: devProxyTarget,
          changeOrigin: true,
          secure: false,
          headers: {
            Origin: "https://erp.m1store-egy.com",
          },
        },
        "/socket.io": {
          target: devProxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      }
    : undefined;

  return {
    root: projectRoot,
    cacheDir: String(env.VITE_CACHE_DIR || "node_modules/.vite"),
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      host: devServerHost,
      port: Number(env.VITE_DEV_PORT || 5173),
      strictPort: true,
      watch: {
        ignored: [
          "**/.codex-*/**",
          ".codex-chrome-qr-headless4/**",
          ".git/**",
          "node_modules/**",
          "dist/**",
          "coverage/**",
        ],
      },
      allowedHosts: true,
      proxy,
    },
    build: {
      modulePreload: {
        resolveDependencies(_filename, deps) {
          // Never eagerly preload admin/export-only heavy chunks. They are reached
          // only through dynamic imports on ERP/admin routes, so preloading them on
          // the customer storefront just wastes bandwidth before first paint.
          return deps.filter(
            (dep) => !/(^|\/)(charts|exports|invoices|qr|qr-scanner|select|jspdf|jspdf-autotable|html2canvas|xlsx|realtime)-/.test(dep),
          );
        },
      },
      rollupOptions: {
        input: {
          app: indexHtml,
        },
        output: {
          // Include the deployment identity even when a chunk's source did not change.
          // This prevents a previously cached HTML fallback from poisoning a JS URL forever.
          entryFileNames: `assets/[name]-[hash]-${buildVersion}.js`,
          chunkFileNames: `assets/[name]-[hash]-${buildVersion}.js`,
          manualChunks(id) {
            const path = id.replace(/\\/g, "/");

            // App source is left to automatic splitting on purpose. Grouping the
            // public invoice route into one manual chunk was tried and reverted: it
            // dragged the page's whole static import subtree in with it and produced
            // a 1.1 MB chunk, replacing many small cached requests with one large
            // uncached download. Same trap the note below describes.
            if (!path.includes("node_modules")) return undefined;

            // lucide-react ships one module per icon, and automatic splitting turned
            // each into its own sub-1 KB chunk — a whole round trip per icon. Grouping
            // them costs nothing in bytes and removes a request per icon everywhere.
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "icons";
            // Split only the framework libs that the entry always needs, for stable
            // long-term caching. Everything else — including admin/export-only heavy
            // libs (recharts, jspdf, xlsx, html2canvas, qr, react-select, socket.io)
            // that are reached ONLY through dynamic import on ERP/admin routes — is
            // left to Rolldown's automatic splitting. A manual chunk for those pulled
            // their whole dependency subtree (redux, d3, use-sync-external-store, …)
            // into one heavy chunk, and a single shared dep then forced the entry to
            // statically import (and download) that ~120 KB chunk on the customer
            // storefront. Letting Rolldown decide keeps dynamic-only libs in async
            // chunks and shared deps in entry-reachable common chunks.
            if (/[\\/]node_modules[\\/]react[\\/]/.test(id)) return "react";
            if (/[\\/]node_modules[\\/]react-dom[\\/]/.test(id)) return "react-dom";
            if (/[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/.test(id)) return "react-router";
            return undefined;
          },
        },
      },
    },
  };
});
