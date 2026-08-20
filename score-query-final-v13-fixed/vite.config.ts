import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 8889,
    proxy: {
      "/api": {
        target: "http://localhost:8889/.netlify/functions",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
