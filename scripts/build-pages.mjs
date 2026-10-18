import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.env.PAGES_OUTPUT_DIR || path.join(root, "_site"));
const repository = process.env.GITHUB_REPOSITORY || "mohamedkhedr98-collab/MyTime_Project";
const repositoryName = repository.split("/")[1];

if (!repositoryName) {
  throw new Error("GITHUB_REPOSITORY must use the owner/repository format.");
}

const basePath = `/${encodeURIComponent(repositoryName)}`;
const excluded = new Set([
  ".git",
  ".github",
  ".vscode",
  "launch.json",
  "node_modules",
  "scripts",
  "tasks.json",
  "_site",
]);
const textExtensions = new Set([".catalog", ".css", ".html", ".js", ".mjs"]);

function copySite(source, destination) {
  mkdirSync(destination, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith(".")) continue;

    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copySite(sourcePath, destinationPath);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!textExtensions.has(extension)) {
      cpSync(sourcePath, destinationPath);
      continue;
    }

    let content = readFileSync(sourcePath, "utf8");
    // Keep backend API routes at the origin; only static assets need the Pages base path.
    content = content.replace(
      /(["'])\/((?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|css|woff2|webp|catalog|html|ico)(?:\?[^"'`\s]*)?)(?=["'])/g,
      `$1${basePath}/$2`,
    );
    if (extension === ".css") {
      content = content.replace(/url\((\s*["']?)\/(?!\/)/g, `url($1${basePath}/`);
    }
    if (path.basename(sourcePath) === "index.html") {
      content = content.replace(/<script\b(?=[^>]*\bdata-cf-beacon=)[^>]*>\s*<\/script>/gi, "");
    }

    writeFileSync(destinationPath, content);
  }
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
copySite(root, output);
writeFileSync(path.join(output, ".nojekyll"), "");

console.log(`Built GitHub Pages site at ${output} for ${basePath}/`);
