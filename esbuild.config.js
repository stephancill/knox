import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const opts = {
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.js",
  external: ["better-sqlite3"],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("watching...");
} else {
  await esbuild.build(opts);
  console.log("build complete");
}
