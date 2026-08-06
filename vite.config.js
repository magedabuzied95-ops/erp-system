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
          return deps.filter((dep) => !/(^|\/)(charts|exports|invoices|qr|qr-scanner|select)-/.test(dep));
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
            if (!id.includes("node_modules")) return undefined;
            if (/[\\/]node_modules[\\/]react[\\/]/.test(id)) return "react";
            if (/[\\/]node_modules[\\/]react-dom[\\/]/.test(id)) return "react-dom";
            if (/[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/.test(id)) return "react-router";
            if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return "charts";
            if (/[\\/]node_modules[\\/]jspdf[\\/]/.test(id)) return "jspdf";
            if (/[\\/]node_modules[\\/]jspdf-autotable[\\/]/.test(id)) return "jspdf-autotable";
            if (/[\\/]node_modules[\\/]html2canvas[\\/]/.test(id)) return "html2canvas";
            if (/[\\/]node_modules[\\/]xlsx[\\/]/.test(id)) return "xlsx";
            if (/[\\/]node_modules[\\/]file-saver[\\/]/.test(id)) return "file-saver";
            if (/[\\/]node_modules[\\/](react-qr-barcode-scanner|html5-qrcode)[\\/]/.test(id)) return "qr-scanner";
            if (/[\\/]node_modules[\\/](qrcode\.react|react-qr-code)[\\/]/.test(id)) return "qr";
            if (/[\\/]node_modules[\\/]react-select[\\/]/.test(id)) return "select";
            if (/[\\/]node_modules[\\/]socket\.io-client[\\/]/.test(id)) return "realtime";
            return "vendor";
          },
        },
      },
    },
  };
});
