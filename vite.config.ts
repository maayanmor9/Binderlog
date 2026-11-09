import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  base: "./",
  build: { chunkSizeWarningLimit: 15000 },
  plugins: [react(), VitePWA({
    registerType: "autoUpdate",
    manifest: { name: "Binderlog", short_name: "Binderlog", display: "standalone", start_url: ".", background_color: "#f6f4ee", theme_color: "#17594a",
      icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png" }] },
    workbox: { maximumFileSizeToCacheInBytes: 25_000_000, globPatterns: ["**/*.{js,css,html,png,webp,json}"], navigateFallback: "index.html" },
  })],
});
