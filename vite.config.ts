import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function copyRuntimeData(): Plugin {
  return {
    name: "copy-runtime-data",
    apply: "build",
    async writeBundle(options) {
      const outputDirectory = path.resolve(String(options.dir ?? "dist"));
      await mkdir(outputDirectory, { recursive: true });
      await cp(path.resolve("data"), path.join(outputDirectory, "data"), {
        recursive: true,
        force: true,
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), copyRuntimeData()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
