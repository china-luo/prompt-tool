import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, makeLocalChineseFallback, REPO_DIR, splitBlocks } from "../server/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_API_DIR = path.join(ROOT_DIR, "dist", "api", "prompts");

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload), "utf8");
}

const index = await buildIndex();
await writeJson(path.join(DIST_API_DIR, "index.json"), index);

for (const item of index.items) {
  const content = await fs.readFile(path.join(REPO_DIR, item.relativePath), "utf8");
  await writeJson(path.join(DIST_API_DIR, `${item.id}.json`), { ...item, content });

  const blocks = splitBlocks(content).map((block) => ({
    original: block.original,
    zh: makeLocalChineseFallback(block.original),
    ok: true
  }));

  await writeJson(path.join(DIST_API_DIR, item.id, "translate.json"), {
    id: item.id,
    relativePath: item.relativePath,
    generatedAt: index.generatedAt,
    truncated: false,
    totalBlocks: blocks.length,
    failedBlocks: 0,
    blocks
  });
}

console.log(`Static API generated for ${index.items.length} prompts.`);
