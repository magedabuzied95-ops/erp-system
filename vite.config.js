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
        },
        "/uploads": {
          target: devProxyTarget,
          changeOrigin: true,
          secure: false,
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
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/.test(id)) return "react";
            if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return "charts";
            if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable|html2canvas)[\\/]/.test(id)) return "invoices";
            if (/[\\/]node_modules[\\/](xlsx|file-saver)[\\/]/.test(id)) return "exports";
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
