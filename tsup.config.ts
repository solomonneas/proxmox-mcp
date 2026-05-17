import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "mcp-server": "mcp-server.ts", "index": "index.ts" },
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  splitting: false,
  sourcemap: false,
  external: [/^openclaw(\/|$)/, "undici"],
  banner: { js: "#!/usr/bin/env node" },
});
