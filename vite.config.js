import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: [
      "include-mainland-royalty-boards.trycloudflare.com",
    ],
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        secure: false,
      },
      "/uploads": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
      },
      "/socket.io": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) => !/(^|\/)(charts|exports|invoices)-/.test(dep));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/.test(id)) return "react";
          if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) return "charts";
          if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable|html2canvas)[\\/]/.test(id)) return "invoices";
          if (/[\\/]node_modules[\\/](xlsx|file-saver)[\\/]/.test(id)) return "exports";
          if (/[\\/]node_modules[\\/]socket\.io-client[\\/]/.test(id)) return "realtime";
          return "vendor";
        },
      },
    },
  },
});
