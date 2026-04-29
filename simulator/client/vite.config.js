import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind to all interfaces so Docker port mapping works.
    host: "0.0.0.0",
    // Fail if 5173 is in use so Docker's 5174:5173 mapping stays valid.
    strictPort: true,
  },
});
