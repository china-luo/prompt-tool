import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, REPO_DIR, splitBlocks, translateViaGoogle } from "../server/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT_DIR, "data", ".translation-cache");
const FORCE = process.argv.includes("--force");
const LIMIT = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 0);
const CONCURRENCY = Number(process.env.GOOGLE_TRANSLATE_CONCURRENCY || 3);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function translateBlock(block) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return {
        original: block.original,
        zh: await translateViaGoogle(block.original),
        ok: true
      };
    } catch (error) {
      if (attempt === 3) {
        return {
          original: block.original,
          zh: `Google 翻译失败：${error.message}`,
          ok: false,
          error: error.message
        };
      }
      await wait(800 * attempt);
    }
  }
}

await fs.mkdir(CACHE_DIR, { recursive: true });

const index = await buildIndex();
const itemsWithBlocks = [];
for (const item of index.items) {
  const content = await fs.readFile(path.join(REPO_DIR, item.relativePath), "utf8");
  itemsWithBlocks.push({ item, content, blocks: splitBlocks(content) });
}
itemsWithBlocks.sort((a, b) => a.blocks.length - b.blocks.length || a.item.relativePath.localeCompare(b.item.relativePath));
const items = LIMIT ? itemsWithBlocks.slice(0, LIMIT) : itemsWithBlocks;
let translatedFiles = 0;
let skippedFiles = 0;
let failedBlocks = 0;

for (const [itemIndex, entry] of items.entries()) {
  const { item, content, blocks } = entry;
  const contentHash = createHash("sha1").update(content).digest("hex").slice(0, 12);
  const cachePath = path.join(CACHE_DIR, `${item.id}-${contentHash}-full.json`);
  const cached = await readJsonIfExists(cachePath);

  if (!FORCE && cached?.translationProvider === "google" && cached?.totalBlocks === blocks.length) {
    skippedFiles += 1;
    console.log(`[${itemIndex + 1}/${items.length}] skip ${item.relativePath}`);
    continue;
  }

  console.log(`[${itemIndex + 1}/${items.length}] translate ${item.relativePath} (${blocks.length} blocks)`);
  const translatedBlocks = await mapWithConcurrency(blocks, CONCURRENCY, translateBlock);
  const fileFailedBlocks = translatedBlocks.filter((block) => !block.ok).length;
  failedBlocks += fileFailedBlocks;

  const payload = {
    id: item.id,
    relativePath: item.relativePath,
    generatedAt: new Date().toISOString(),
    translationProvider: "google",
    truncated: false,
    totalBlocks: translatedBlocks.length,
    failedBlocks: fileFailedBlocks,
    blocks: translatedBlocks
  };

  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), "utf8");
  translatedFiles += 1;
  console.log(
    `[${itemIndex + 1}/${items.length}] wrote ${path.relative(ROOT_DIR, cachePath).replace(/\\/g, "/")} failedBlocks=${fileFailedBlocks}`
  );
}

console.log(
  JSON.stringify(
    {
      totalFiles: items.length,
      translatedFiles,
      skippedFiles,
      failedBlocks,
      provider: "google"
    },
    null,
    2
  )
);
