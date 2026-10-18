import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mockDashboardApi } from "./mock/plugin";

const here = path.dirname(fileURLToPath(import.meta.url));

// The daemon serves exactly /seller.html (as "/"), /task.html, /seller.js and
// /seller.css from apps/agent-daemon/ui, so the build uses those fixed names.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "mock" ? [mockDashboardApi()] : [])],
  resolve: { alias: { "@": path.resolve(here, "src") } },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  preview: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: {
    outDir: path.resolve(here, "../agent-daemon/ui"),
    emptyOutDir: false,
    modulePreload: false,
    rollupOptions: {
      input: path.resolve(here, "seller.html"),
      output: {
        inlineDynamicImports: true,
        entryFileNames: "seller.js",
        chunkFileNames: "seller-[name].js",
        assetFileNames: "seller.[ext]",
      },
    },
  },
}));
