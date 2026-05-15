import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const FUNCTIONS_PROXY_TARGET = "http://127.0.0.1:5001/crowdpm-local/us-central1/crowdpmApi";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: FUNCTIONS_PROXY_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/, ""),
      },
    },
  },
});
