import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@hafbit/react-acp/core",
        replacement: fileURLToPath(new URL("../../src/core/index.ts", import.meta.url)),
      },
      {
        find: "@hafbit/react-acp/primitives",
        replacement: fileURLToPath(new URL("../../src/primitives/index.ts", import.meta.url)),
      },
      {
        find: "@hafbit/react-acp",
        replacement: fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
      },
    ],
  },
  server: { port: 4173 },
});
