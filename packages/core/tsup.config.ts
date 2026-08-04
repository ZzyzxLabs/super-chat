import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", openai: "src/providers/openai/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
