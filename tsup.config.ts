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
    js: "// mcp-diet — MCP context-diet proxy. https://github.com/mcp-diet/mcp-diet",
  },
});
