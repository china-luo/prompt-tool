import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildIndex, makeLocalChineseFallback, REPO_DIR, splitBlocks } from "../server/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const STATIC_DIST_DIR = process.argv[2] || process.env.STATIC_DIST_DIR || "dist";
const DIST_API_DIR = path.join(ROOT_DIR, STATIC_DIST_DIR, "api", "prompts");
const TRANSLATION_CACHE_DIR = path.join(ROOT_DIR, "data", ".translation-cache");

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload), "utf8");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

const index = await buildIndex();
await writeJson(path.join(DIST_API_DIR, "index.json"), index);

for (const item of index.items) {
  const content = await fs.readFile(path.join(REPO_DIR, item.relativePath), "utf8");
  await writeJson(path.join(DIST_API_DIR, `${item.id}.json`), { ...item, content });

  const sourceBlocks = splitBlocks(content);
  const contentHash = createHash("sha1").update(content).digest("hex").slice(0, 12);
  const cachePath = path.join(TRANSLATION_CACHE_DIR, `${item.id}-${contentHash}-full.json`);
  const cachedTranslation = await readJsonIfExists(cachePath);
  const blocks =
    cachedTranslation?.translationProvider === "google" && cachedTranslation?.blocks?.length === sourceBlocks.length
      ? cachedTranslation.blocks
      : sourceBlocks.map((block) => ({
          original: block.original,
          zh: makeLocalChineseFallback(block.original),
          ok: true
        }));

  await writeJson(path.join(DIST_API_DIR, item.id, "translate.json"), {
    id: item.id,
    relativePath: item.relativePath,
    generatedAt: index.generatedAt,
    translationProvider: cachedTranslation?.translationProvider === "google" ? "google" : "local-fallback",
    truncated: false,
    totalBlocks: blocks.length,
    failedBlocks: blocks.filter((block) => !block.ok).length,
    blocks
  });
}

console.log(`Static API generated for ${index.items.length} prompts.`);
