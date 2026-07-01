import express from "express";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const REPO_URL = "https://github.com/asgeirtj/system_prompts_leaks.git";
const REPO_DIR = path.join(ROOT_DIR, "data", "system_prompts_leaks");
const TRANSLATION_CACHE_DIR = path.join(ROOT_DIR, "data", ".translation-cache");
const PORT = Number(process.env.PORT || 4177);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".xml", ".json"]);
const EXCLUDED_DIRS = new Set([".git", ".github"]);
const EXCLUDED_FILES = new Set(["README.md", "LICENSE"]);
const TRANSLATION_CONCURRENCY = 5;
const TRANSLATION_CHUNK_SIZE = 520;
const EXTERNAL_TRANSLATION_BLOCK_LIMIT = 24;

const PURPOSES = [
  {
    key: "chatbot",
    label: "通用聊天模型",
    description: "面向 ChatGPT、Claude、Gemini、Grok、Qwen 等通用对话模型的核心系统提示词。"
  },
  {
    key: "coding",
    label: "编程与开发代理",
    description: "用于代码生成、工程协作、IDE、命令行代理、代码审查和开发工作流。"
  },
  {
    key: "tools",
    label: "工具调用与能力",
    description: "明确描述工具、函数、参数、技能、API 或能力调用方式的提示词。"
  },
  {
    key: "computer",
    label: "本地计算机操作",
    description: "要求模型读取屏幕、点击、输入、拖拽、操作本地应用或浏览器界面的提示词。"
  },
  {
    key: "office",
    label: "办公与知识生产",
    description: "覆盖 Word、Excel、PowerPoint、Notion、NotebookLM、Workspace 等办公和知识场景。"
  },
  {
    key: "browser",
    label: "浏览器与搜索助手",
    description: "用于浏览器助手、网页搜索、信息检索、答案聚合和联网阅读。"
  },
  {
    key: "persona",
    label: "人格、风格与模式",
    description: "定义模型人格、语气、风格预设、角色模式和交互偏好。"
  },
  {
    key: "safety",
    label: "安全、策略与边界",
    description: "安全策略、内容政策、提醒、权限边界、确认流程和风险控制提示词。"
  },
  {
    key: "multimodal",
    label: "多模态与语音图像",
    description: "涉及图像、语音、音频、移动端、多模态理解或生成的提示词。"
  },
  {
    key: "other",
    label: "其他/未明确用途",
    description: "正文证据不足以归入特定用途，或只与某类用途有轻微关联的提示词。"
  }
];

let indexCache = null;

const app = express();
app.use(express.json());

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: ROOT_DIR, windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureRepo() {
  if (await pathExists(path.join(REPO_DIR, ".git"))) {
    return;
  }
  if (await pathExists(REPO_DIR)) {
    await fs.rm(REPO_DIR, { recursive: true, force: true });
  }
  await fs.mkdir(path.dirname(REPO_DIR), { recursive: true });
  await run("git", ["clone", REPO_URL, REPO_DIR]);
}

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
      continue;
    }

    const relativePath = path.relative(REPO_DIR, fullPath).replaceAll(path.sep, "/");
    const extension = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) || EXCLUDED_FILES.has(relativePath)) {
      continue;
    }
    files.push({ fullPath, relativePath, extension: extension.slice(1) });
  }
  return files;
}

function makeId(relativePath) {
  return createHash("sha1").update(relativePath).digest("hex").slice(0, 16);
}

function prettyName(value) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractTitle(content, relativePath) {
  const markdownTitle = content.match(/^#\s+(.+)$/m);
  if (markdownTitle) {
    return markdownTitle[1].replace(/[*`]/g, "").trim();
  }

  const firstUsefulLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("```") && !line.startsWith("---"));

  if (firstUsefulLine && firstUsefulLine.length <= 96) {
    return firstUsefulLine.replace(/^#+\s*/, "").replace(/[*`]/g, "").trim();
  }

  return prettyName(path.basename(relativePath));
}

function makeExcerpt(content) {
  return content
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function parseRecentMap(readme) {
  const recentMap = new Map();
  const section = readme.match(/## Recently Updated([\s\S]*?)\n---\s*\n/);
  if (!section) {
    return recentMap;
  }

  for (const line of section[1].split(/\r?\n/)) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4 || cells[1] === "What" || cells[1].startsWith("-")) {
      continue;
    }

    const label = cells[1].replace(/\*\*/g, "");
    const date = cells[2];
    for (const match of cells[3].matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const link = decodeURIComponent(match[1]).replaceAll("\\", "/");
      if (!link.startsWith("http")) {
        recentMap.set(link, { label, date });
      }
    }
  }
  return recentMap;
}

async function getGitInfo(relativePath) {
  try {
    const [{ stdout: isoDate }, { stdout: subject }] = await Promise.all([
      run("git", ["-C", REPO_DIR, "log", "-1", "--format=%cI", "--", relativePath]),
      run("git", ["-C", REPO_DIR, "log", "-1", "--format=%s", "--", relativePath])
    ]);
    return { updatedAt: isoDate || null, commitSubject: subject || "" };
  } catch {
    return { updatedAt: null, commitSubject: "" };
  }
}

const PURPOSE_RULES = [
  {
    key: "safety",
    threshold: 9,
    anchors: [
      "safety policy",
      "content policy",
      "must refuse",
      "disallowed content",
      "policy violation",
      "cannot assist"
    ],
    terms: [
      ["safety policy", 6],
      ["content policy", 6],
      ["must refuse", 5],
      ["disallowed content", 5],
      ["policy violation", 4],
      ["cannot assist", 4],
      ["confirmation policy", 4],
      ["guardrail", 4],
      ["security review", 4]
    ]
  },
  {
    key: "computer",
    threshold: 12,
    minDistinctAnchors: 2,
    anchors: [
      "computer use",
      "read the screen",
      "screen and performing ui actions",
      "use mouse and keyboard",
      "interact with local"
    ],
    terms: [
      ["computer use", 6],
      ["read the screen", 6],
      ["screen and performing ui actions", 6],
      ["use mouse and keyboard", 5],
      ["interact with local", 5],
      ["local apps", 4],
      ["pressing keys", 3],
      ["ui actions", 3],
      ["drag and drop", 3]
    ]
  },
  {
    key: "browser",
    threshold: 9,
    anchors: [
      "browser automation",
      "open the browser",
      "page snapshot",
      "chrome profile",
      "search results",
      "web browser"
    ],
    terms: [
      ["browser automation", 6],
      ["open the browser", 5],
      ["page snapshot", 4],
      ["visible page", 4],
      ["chrome profile", 5],
      ["search results", 4],
      ["web browser", 4],
      ["web page", 2],
      ["navigate to a url", 3],
      ["internet search", 3]
    ]
  },
  {
    key: "coding",
    threshold: 10,
    anchors: [
      "software engineering",
      "coding agent",
      "codebase",
      "write code",
      "edit files",
      "run tests",
      "pull request",
      "code review"
    ],
    terms: [
      ["software engineering", 6],
      ["coding agent", 6],
      ["codebase", 5],
      ["repository", 3],
      ["write code", 5],
      ["edit files", 5],
      ["run tests", 5],
      ["pull request", 5],
      ["code review", 6],
      ["debug", 2],
      ["terminal command", 3],
      ["commit changes", 3]
    ]
  },
  {
    key: "tools",
    threshold: 11,
    anchors: [
      "available tools",
      "tool call",
      "function call",
      "tool definitions",
      "use the tool",
      "valid recipients",
      "namespace"
    ],
    terms: [
      ["available tools", 6],
      ["tool call", 6],
      ["function call", 5],
      ["tool definitions", 5],
      ["use the tool", 5],
      ["api endpoint", 4],
      ["namespace", 3],
      ["valid recipients", 4],
      ["parameters", 2],
      ["schema", 2]
    ]
  },
  {
    key: "office",
    threshold: 16,
    anchors: [
      "microsoft word",
      "powerpoint",
      "spreadsheet",
      "excel",
      "notion",
      "google docs",
      "microsoft office"
    ],
    terms: [
      ["microsoft word", 6],
      ["powerpoint", 6],
      ["spreadsheet", 5],
      ["excel", 6],
      ["notion", 10],
      ["google docs", 5],
      ["microsoft office", 5],
      ["presentation slides", 4],
      ["word document", 4]
    ]
  },
  {
    key: "persona",
    threshold: 12,
    anchors: [
      "codex personality",
      "personality",
      "persona",
      "tone and style",
      "style preset"
    ],
    terms: [
      ["codex personality", 8],
      ["personality", 6],
      ["persona", 6],
      ["tone and style", 5],
      ["communication style", 5],
      ["style preset", 5]
    ]
  },
  {
    key: "multimodal",
    threshold: 8,
    anchors: [
      "image generation",
      "image safety",
      "generate images",
      "voice mode",
      "audio input",
      "multimodal"
    ],
    terms: [
      ["image generation", 6],
      ["image safety", 6],
      ["generate images", 5],
      ["voice mode", 5],
      ["audio input", 5],
      ["audio", 3],
      ["vision", 4],
      ["image input", 4],
      ["youtube", 3],
      ["multimodal", 6]
    ]
  },
  {
    key: "chatbot",
    threshold: 6,
    anchors: [
      "you are chatgpt",
      "you are claude",
      "assistant is claude",
      "you are gemini",
      "you are grok",
      "large language model",
      "general-purpose ai assistant"
    ],
    terms: [
      ["you are chatgpt", 6],
      ["you are claude", 6],
      ["assistant is claude", 6],
      ["you are gemini", 6],
      ["you are grok", 6],
      ["large language model", 5],
      ["general-purpose ai assistant", 5],
      ["general assistant", 4],
      ["answer the user", 3],
      ["conversation with the user", 3]
    ]
  }
];

function countOccurrences(text, term) {
  let count = 0;
  let position = text.indexOf(term);
  while (position !== -1) {
    count += 1;
    position = text.indexOf(term, position + term.length);
  }
  return count;
}

function classifyPurpose(content) {
  const text = content.toLowerCase();
  const scores = PURPOSE_RULES.map((rule) => {
    const anchorHits = (rule.anchors || []).reduce((total, term) => {
      return total + Math.min(countOccurrences(text, term), 3);
    }, 0);
    const distinctAnchorHits = (rule.anchors || []).filter((term) => countOccurrences(text, term) > 0).length;
    if ((rule.anchors || []).length > 0 && anchorHits === 0) {
      return { key: rule.key, score: 0, threshold: rule.threshold };
    }
    if (rule.minDistinctAnchors && distinctAnchorHits < rule.minDistinctAnchors) {
      return { key: rule.key, score: 0, threshold: rule.threshold };
    }
    const score = rule.terms.reduce((total, [term, weight]) => {
      return total + Math.min(countOccurrences(text, term), 3) * weight;
    }, 0);
    return { key: rule.key, score, threshold: rule.threshold };
  }).sort((a, b) => b.score - a.score);

  const [best, second] = scores;
  if (!best || best.score < best.threshold) {
    return "other";
  }
  if (second && best.score - second.score < 3 && best.score < best.threshold + 4) {
    return "other";
  }
  return best.key;
}

function sortByUpdateThenName(a, b) {
  const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  if (aTime !== bTime) {
    return bTime - aTime;
  }
  return a.title.localeCompare(b.title);
}

function splitBlocks(content, maxBlockLength = 1200) {
  const source = content.replace(/\r\n/g, "\n").trim();
  const rawBlocks = source.includes("\n\n") ? source.split(/\n{2,}/) : source.split(/\n/);
  const blocks = [];

  for (const rawBlock of rawBlocks) {
    const cleanBlock = rawBlock.replace(/\n{3,}/g, "\n\n").trim();
    if (!cleanBlock) {
      continue;
    }

    for (let index = 0; index < cleanBlock.length; index += maxBlockLength) {
      const original = cleanBlock.slice(index, index + maxBlockLength).trim();
      if (original) {
        blocks.push({ original });
      }
    }
  }

  return blocks;
}

function splitTranslationRequest(text, maxLength = TRANSLATION_CHUNK_SIZE) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > maxLength) {
    const slice = rest.slice(0, maxLength);
    const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"), slice.lastIndexOf("; "));
    const cut = boundary > 160 ? boundary + 1 : maxLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) {
    chunks.push(rest);
  }
  return chunks;
}

async function translateViaGoogle(text) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", "zh-CN");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) {
    throw new Error(`translation request failed: ${response.status}`);
  }
  const payload = await response.json();
  return (payload?.[0] || []).map((part) => part?.[0] || "").join("").trim();
}

async function translateViaMyMemory(text) {
  const chunks = splitTranslationRequest(text);
  const translated = [];

  for (const chunk of chunks) {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", chunk);
    url.searchParams.set("langpair", "en|zh-CN");

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      throw new Error(`fallback translation request failed: ${response.status}`);
    }
    const payload = await response.json();
    const translatedText = payload?.responseData?.translatedText || "";
    if (!response.ok || payload?.responseStatus >= 400 || /MYMEMORY WARNING/i.test(translatedText)) {
      throw new Error(payload?.responseDetails || `fallback translation request failed: ${response.status}`);
    }
    translated.push(translatedText || chunk);
  }

  return translated.join("\n").trim();
}

function makeLocalChineseFallback(text) {
  const glossary = [
    [/Computer Use/g, "计算机使用"],
    [/Browser Use/g, "浏览器使用"],
    [/Chrome/g, "Chrome 浏览器"],
    [/Codex/g, "Codex"],
    [/Claude Code/g, "Claude Code"],
    [/system prompt/gi, "系统提示词"],
    [/system instructions/gi, "系统指令"],
    [/instructions/gi, "指令"],
    [/tool/gi, "工具"],
    [/tools/gi, "工具"],
    [/skill/gi, "技能"],
    [/browser/gi, "浏览器"],
    [/local apps/gi, "本地应用"],
    [/screen/gi, "屏幕"],
    [/UI actions/gi, "界面操作"],
    [/clicking/gi, "点击"],
    [/typing/gi, "输入"],
    [/scrolling/gi, "滚动"],
    [/dragging/gi, "拖拽"],
    [/pressing keys/gi, "按键"],
    [/settings?/gi, "设置"],
    [/confirmation policy/gi, "确认策略"],
    [/policy/gi, "策略"],
    [/user/gi, "用户"],
    [/task/gi, "任务"],
    [/tasks/gi, "任务"],
    [/file/gi, "文件"],
    [/files/gi, "文件"],
    [/code/gi, "代码"],
    [/review/gi, "审查"],
    [/search/gi, "搜索"],
    [/image/gi, "图像"],
    [/voice/gi, "语音"],
    [/model/gi, "模型"],
    [/agent/gi, "代理"],
    [/workspace/gi, "工作区"],
    [/environment/gi, "环境"],
    [/permission/gi, "权限"],
    [/safety/gi, "安全"],
    [/risk/gi, "风险"],
    [/response/gi, "响应"],
    [/conversation/gi, "对话"],
    [/prompt/gi, "提示词"]
  ];

  const translatedLines = text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "";

    if (/^---$/.test(trimmed)) return "---";
    if (/^#+\s+/.test(trimmed)) return trimmed.replace(/^#+\s+/, "标题：");
    if (/^name:\s*/i.test(trimmed)) return trimmed.replace(/^name:\s*/i, "名称：");
    if (/^description:\s*/i.test(trimmed)) return trimmed.replace(/^description:\s*/i, "说明：");

    let output = trimmed;
    for (const [pattern, replacement] of glossary) {
      output = output.replace(pattern, replacement);
    }
    return `中文说明：${output}`;
  });

  return translatedLines.join("\n");
}

async function translateText(text) {
  if (!/[A-Za-z]/.test(text)) {
    return text;
  }

  try {
    return await translateViaMyMemory(text);
  } catch {
    try {
      return await translateViaGoogle(text);
    } catch {
      return makeLocalChineseFallback(text);
    }
  }
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

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function buildIndex() {
  await ensureRepo();

  const readme = await fs.readFile(path.join(REPO_DIR, "README.md"), "utf8");
  const recentMap = parseRecentMap(readme);
  const sourceFiles = await walk(REPO_DIR);
  const items = [];

  for (const file of sourceFiles) {
    const content = await fs.readFile(file.fullPath, "utf8");
    const stat = await fs.stat(file.fullPath);
    const segments = file.relativePath.split("/");
    const recent = recentMap.get(file.relativePath);
    const gitInfo = await getGitInfo(file.relativePath);
    const lineCount = content.split(/\r?\n/).length;
    const title = extractTitle(content, file.relativePath);
    const excerpt = makeExcerpt(content);
    const purposeKey = classifyPurpose(content);
    const purpose = PURPOSES.find((candidate) => candidate.key === purposeKey) || PURPOSES.at(-1);

    items.push({
      id: makeId(file.relativePath),
      title,
      group: segments[0] || "Misc",
      subgroup: segments.length > 2 ? segments[1] : "",
      purposeKey: purpose.key,
      purposeLabel: purpose.label,
      purposeDescription: purpose.description,
      relativePath: file.relativePath,
      extension: file.extension,
      size: stat.size,
      lineCount,
      excerpt,
      updatedAt: gitInfo.updatedAt,
      commitSubject: gitInfo.commitSubject,
      recentLabel: recent?.label || "",
      recentDate: recent?.date || "",
      githubUrl: `https://github.com/asgeirtj/system_prompts_leaks/blob/main/${file.relativePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`
    });
  }

  items.sort(sortByUpdateThenName);

  const sourceGroups = Array.from(
    items.reduce((map, item) => {
      const current = map.get(item.group) || { name: item.group, count: 0, subgroups: new Map() };
      current.count += 1;
      if (item.subgroup) {
        current.subgroups.set(item.subgroup, (current.subgroups.get(item.subgroup) || 0) + 1);
      }
      map.set(item.group, current);
      return map;
    }, new Map()).values()
  )
    .map((group) => ({
      ...group,
      subgroups: Array.from(group.subgroups.entries()).map(([name, count]) => ({ name, count }))
    }))
    .sort((a, b) => b.count - a.count);

  const purposeGroups = PURPOSES.map((purpose) => ({
    ...purpose,
    count: items.filter((item) => item.purposeKey === purpose.key).length
  })).filter((purpose) => purpose.count > 0);

  let head = "";
  let headDate = "";
  try {
    head = (await run("git", ["-C", REPO_DIR, "rev-parse", "--short", "HEAD"])).stdout;
    headDate = (await run("git", ["-C", REPO_DIR, "log", "-1", "--format=%cI"])).stdout;
  } catch {
    head = "";
    headDate = "";
  }

  indexCache = {
    repoUrl: REPO_URL,
    repoPath: REPO_DIR,
    generatedAt: new Date().toISOString(),
    head,
    headDate,
    total: items.length,
    groups: sourceGroups,
    purposeGroups,
    items
  };

  return indexCache;
}

app.get("/api/prompts", async (_request, response) => {
  try {
    response.json(indexCache || (await buildIndex()));
  } catch (error) {
    response.status(500).json({ message: "索引提示词失败", detail: error.message });
  }
});

app.get("/api/prompts/:id/translate", async (request, response) => {
  try {
    const index = indexCache || (await buildIndex());
    const item = index.items.find((candidate) => candidate.id === request.params.id);
    if (!item) {
      response.status(404).json({ message: "未找到对应提示词" });
      return;
    }

    const content = await fs.readFile(path.join(REPO_DIR, item.relativePath), "utf8");
    const contentHash = createHash("sha1").update(content).digest("hex").slice(0, 12);
    const cachePath = path.join(TRANSLATION_CACHE_DIR, `${item.id}-${contentHash}-full.json`);
    const cached = await readJsonIfExists(cachePath);
    if (cached) {
      response.json({ ...cached, cached: true });
      return;
    }

    const blocks = splitBlocks(content);
    const shouldUseExternalTranslation = blocks.length <= EXTERNAL_TRANSLATION_BLOCK_LIMIT;
    const translatedBlocks = await mapWithConcurrency(blocks, TRANSLATION_CONCURRENCY, async (block) => {
      try {
        return {
          original: block.original,
          zh: shouldUseExternalTranslation ? await translateText(block.original) : makeLocalChineseFallback(block.original),
          ok: true
        };
      } catch (error) {
        return {
          original: block.original,
          zh: "这一段暂时翻译失败，请稍后重新打开或切换到完整原文查看。",
          ok: false,
          error: error.message
        };
      }
    });

    const payload = {
      id: item.id,
      relativePath: item.relativePath,
      generatedAt: new Date().toISOString(),
      truncated: false,
      totalBlocks: translatedBlocks.length,
      failedBlocks: translatedBlocks.filter((block) => !block.ok).length,
      blocks: translatedBlocks
    };

    await fs.mkdir(TRANSLATION_CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), "utf8");
    response.json({ ...payload, cached: false });
  } catch (error) {
    response.status(500).json({
      message: "生成中文对照失败",
      detail: error.message
    });
  }
});

app.get("/api/prompts/:id", async (request, response) => {
  try {
    const index = indexCache || (await buildIndex());
    const item = index.items.find((candidate) => candidate.id === request.params.id);
    if (!item) {
      response.status(404).json({ message: "未找到对应提示词" });
      return;
    }
    const content = await fs.readFile(path.join(REPO_DIR, item.relativePath), "utf8");
    response.json({ ...item, content });
  } catch (error) {
    response.status(500).json({ message: "读取提示词失败", detail: error.message });
  }
});

app.post("/api/update", async (_request, response) => {
  try {
    await ensureRepo();
    const before = await run("git", ["-C", REPO_DIR, "rev-parse", "--short", "HEAD"]);
    const pull = await run("git", ["-C", REPO_DIR, "pull", "--ff-only"]);
    const after = await run("git", ["-C", REPO_DIR, "rev-parse", "--short", "HEAD"]);
    const index = await buildIndex();

    response.json({
      changed: before.stdout !== after.stdout,
      before: before.stdout,
      after: after.stdout,
      output: pull.stdout || pull.stderr || "Already up to date.",
      index
    });
  } catch (error) {
    response.status(500).json({
      message: "更新仓库失败",
      detail: error.stderr || error.stdout || error.message
    });
  }
});

app.use(express.static(path.join(ROOT_DIR, "dist")));
app.use(async (_request, response) => {
  const indexHtml = path.join(ROOT_DIR, "dist", "index.html");
  if (await pathExists(indexHtml)) {
    response.sendFile(indexHtml);
    return;
  }
  response.status(404).send("Run npm run build first, or use npm run dev for Vite.");
});

export { buildIndex, makeLocalChineseFallback, REPO_DIR, splitBlocks };

if (process.argv[1] === __filename) {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Prompt API listening on http://127.0.0.1:${PORT}`);
  });
}
