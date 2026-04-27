import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const vitePort = Number(process.env.VITE_PORT || 5173);
const apiPort = Number(process.env.API_PORT || 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    port: vitePort,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true
      }
    }
  }
});
