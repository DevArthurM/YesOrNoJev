import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  // Bundle every dependency so the production image needs no node_modules at all.
  noExternal: [/.*/],
  // Keep `node:` imports intact: `node:sqlite` only exists with the prefix.
  removeNodeProtocol: false,
});
