import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Allow connections coming through localtunnel (random *.loca.lt subdomains)
    // and any other host, since this is only used for local/dev sharing.
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
  },
});
