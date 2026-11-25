// Bundle src/main.ts into one self-contained HTML page (the artifact).
// Usage: node build.mjs [esbuild-path] [out.html]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const esbuild = process.argv[2] || "esbuild";
const out = process.argv[3] || join(here, "dist", "jm-render-studio.html");
const js = execFileSync(esbuild, [join(here, "src/main.ts"), "--bundle", "--format=iife", "--target=chrome120", "--minify", "--legal-comments=none"], { maxBuffer: 64 << 20 }).toString();
const html = readFileSync(join(here, "template.html"), "utf8").replace("/*BUNDLE*/", () => js.replace(/<\/script/gi, "<\\/script"));
execFileSync("mkdir", ["-p", dirname(out)]);
writeFileSync(out, html);
console.log(out, (html.length / 1024).toFixed(0) + " KB");
