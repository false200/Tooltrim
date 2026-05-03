import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: false,
  treeshake: true,
  minify: false,
  banner: {
    js: "// LeanMCP — MCP proxy. https://github.com/leanmcp/leanmcp",
  },
});
