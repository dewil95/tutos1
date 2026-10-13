import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vitest/config";

/**
 * The Prisma client is generated for Cloudflare (runtime = "cloudflare"), so it imports its
 * query compiler as `./query_compiler_fast_bg.wasm?module`, which wrangler turns into a
 * WebAssembly.Module. Node tests get the same module from the file on disk.
 */
export function wasmModule(): Plugin {
  const suffix = "\0wasm-module";
  return {
    name: "mca-wasm-module",
    enforce: "pre",
    resolveId(source, importer) {
      if (!source.endsWith(".wasm?module") || !importer) return null;
      return resolve(dirname(importer), source.replace(/\?module$/, "")) + suffix;
    },
    load(id) {
      if (!id.endsWith(suffix)) return null;
      const file = id.slice(0, -suffix.length);
      readFileSync(file); // fail early with a clear path if `prisma generate` was not run
      return `import { readFileSync } from "node:fs";\nexport default new WebAssembly.Module(readFileSync(${JSON.stringify(file)}));\n`;
    },
  };
}
