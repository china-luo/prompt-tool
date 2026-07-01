import React, { useEffect, useMemo, useState, useTransition } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowClockwise,
  ArrowSquareOut,
  BracketsCurly,
  CheckCircle,
  Copy,
  FileText,
  GlobeHemisphereEast,
  MagnifyingGlass,
  Rows,
  SidebarSimple,
  Sparkle,
  TextColumns
} from "@phosphor-icons/react";
import "./styles.css";

const ALL_PURPOSES = "全部用途";
const ALL_SOURCES = "全部来源";
const STATIC_API = import.meta.env.VITE_STATIC_API === "true";
const API_ROOT = STATIC_API ? `${import.meta.env.BASE_URL}api` : "/api";

function apiUrl(path) {
  if (!STATIC_API) {
    return `${API_ROOT}${path}`;
  }
  if (path === "/prompts") {
    return `${API_ROOT}/prompts/index.json`;
  }
  const translateMatch = path.match(/^\/prompts\/([^/]+)\/translate$/);
  if (translateMatch) {
    return `${API_ROOT}/prompts/${translateMatch[1]}/translate.json`;
  }
  const promptMatch = path.match(/^\/prompts\/([^/]+)$/);
  if (promptMatch) {
    return `${API_ROOT}/prompts/${promptMatch[1]}.json`;
  }
  return `${API_ROOT}${path}`;
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return "未知";
  return dateFormatter.format(new Date(value));
}

function normalize(value) {
  return value.toLowerCase().trim();
}

function splitContentBlocks(content) {
  const source = content.replace(/\r\n/g, "\n").trim();
  const rawBlocks = source.includes("\n\n") ? source.split(/\n{2,}/) : source.split(/\n/);
  const blocks = [];

  for (const rawBlock of rawBlocks) {
    const cleanBlock = rawBlock.trim();
    if (!cleanBlock) continue;
    for (let index = 0; index < cleanBlock.length; index += 1200) {
      const block = cleanBlock.slice(index, index + 1200).trim();
      if (block) blocks.push(block);
    }
  }

  return blocks;
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <FileText size={32} weight="duotone" />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function BilingualPreview({ prompt, translation, mode, canEditTranslation, onSaveTranslation }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftBlocks, setDraftBlocks] = useState([]);
  const [saveState, setSaveState] = useState({ type: "idle", text: "" });

  useEffect(() => {
    setIsEditing(false);
    setSaveState({ type: "idle", text: "" });
    setDraftBlocks(translation?.blocks || []);
  }, [prompt.id, translation]);

  function updateDraft(index, value) {
    setDraftBlocks((blocks) => {
      const nextBlocks = [...blocks];
      const current = nextBlocks[index] || {};
      nextBlocks[index] = { ...current, zh: value, ok: current.ok !== false };
      return nextBlocks;
    });
  }

  async function saveDraft() {
    if (!canEditTranslation) {
      setSaveState({ type: "error", text: "静态部署无法保存，请在本地运行后编辑。" });
      return;
    }
    setSaveState({ type: "saving", text: "正在保存译文..." });
    try {
      await onSaveTranslation(draftBlocks);
      setIsEditing(false);
      setSaveState({ type: "saved", text: "已保存到本地翻译缓存文件。" });
    } catch (error) {
      setSaveState({ type: "error", text: error.message });
    }
  }

  if (mode === "source") {
    return <pre className="source-view">{prompt.content}</pre>;
  }

  const sourceBlocks = splitContentBlocks(prompt.content);

  if (translation?.error) {
    return (
      <div className="bilingual-view">
        <div className="language-head">
          <span>English Original</span>
          <span>中文对照生成失败</span>
        </div>
        {sourceBlocks.map((block, index) => (
          <article className="translation-row" key={`${block.slice(0, 24)}-${index}`}>
            <p className="original-text">{block}</p>
            <p className="translated-text failed-copy">
              {index === 0 ? `${translation.error}。可切换到完整原文继续阅读。` : "中文翻译暂不可用。"}
            </p>
          </article>
        ))}
      </div>
    );
  }

  if (!translation) {
    return (
      <div className="bilingual-view">
        <div className="language-head">
          <span>English Original</span>
          <span>中文对照生成中</span>
        </div>
        {sourceBlocks.map((block, index) => (
          <article className="translation-row" key={`${block.slice(0, 24)}-${index}`}>
            <p className="original-text">{block}</p>
            <p className="translated-text loading-copy">
              正在生成第 {index + 1} / {sourceBlocks.length} 段中文翻译...
            </p>
          </article>
        ))}
      </div>
    );
  }

  const translatedMap = new Map(translation.blocks.map((block, index) => [index, block]));
  const draftMap = new Map(draftBlocks.map((block, index) => [index, block]));

  return (
    <div className="bilingual-view">
      <div className="language-head">
        <span>English Original</span>
        <span className="translation-head-actions">
          <span>
            {"\u4e2d\u6587\u5bf9\u7167"}
            {translation.failedBlocks ? "\uff0c" + translation.failedBlocks + " \u6bb5\u5931\u8d25" : ""}
          </span>
          <span className="translation-editor-actions">
            {saveState.text && <em className={"translation-save-state " + saveState.type}>{saveState.text}</em>}
            {isEditing ? (
              <>
                <button type="button" className="ghost-action" onClick={() => setIsEditing(false)} disabled={saveState.type === "saving"}>
                  {"\u53d6\u6d88"}
                </button>
                <button type="button" className="save-translation-button" onClick={saveDraft} disabled={saveState.type === "saving"}>
                  {saveState.type === "saving" ? "\u4fdd\u5b58\u4e2d" : "\u4fdd\u5b58\u8bd1\u6587"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ghost-action"
                onClick={() => setIsEditing(true)}
                disabled={!translation.blocks.length}
                title={canEditTranslation ? "\u7f16\u8f91\u4e2d\u6587\u8bd1\u6587" : "\u9759\u6001\u90e8\u7f72\u65e0\u6cd5\u4fdd\u5b58\uff0c\u8bf7\u5728\u672c\u5730\u8fd0\u884c\u540e\u7f16\u8f91"}
              >
                {"\u7f16\u8f91\u4e2d\u6587"}
              </button>
            )}
          </span>
        </span>
      </div>
      {sourceBlocks.map((block, index) => {
        const translatedBlock = translatedMap.get(index);
        const draftBlock = draftMap.get(index) || translatedBlock || {};
        return (
          <article className="translation-row" key={`${block.slice(0, 24)}-${index}`}>
            <p className="original-text">{translatedBlock?.original || block}</p>
            {isEditing ? (
              <div className="translated-text translation-editor-cell">
                <textarea
                  className="translation-textarea"
                  value={draftBlock.zh || ""}
                  onChange={(event) => updateDraft(index, event.target.value)}
                  aria-label={"\u7f16\u8f91\u7b2c " + (index + 1) + " \u6bb5\u4e2d\u6587\u8bd1\u6587"}
                />
              </div>
            ) : (
              <p className={translatedBlock?.ok === false ? "translated-text failed-copy" : "translated-text"}>
                {translatedBlock?.zh || "\u8fd9\u4e00\u6bb5\u4e2d\u6587\u7ffb\u8bd1\u5c1a\u672a\u751f\u6210\u3002"}
              </p>
            )}
          </article>
        );
      })}
      <div className="translation-note">
        已按完整文件分段生成中文对照，共 {translation.totalBlocks || translation.blocks.length} 段。
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [translation, setTranslation] = useState(null);
  const [previewMode, setPreviewMode] = useState("bilingual");
  const [activePurpose, setActivePurpose] = useState(ALL_PURPOSES);
  const [activeSource, setActiveSource] = useState(ALL_SOURCES);
  const [query, setQuery] = useState("");
  const [showRecentOnly, setShowRecentOnly] = useState(false);
  const [status, setStatus] = useState({ type: "loading", text: "正在建立本地索引" });
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/prompts"))
      .then((response) => {
        if (!response.ok) throw new Error("读取索引失败");
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setStatus({ type: "ready", text: `已索引 ${payload.total} 个提示词文件` });
      })
      .catch((error) => {
        if (!cancelled) setStatus({ type: "error", text: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedPrompt(null);
      setTranslation(null);
      return;
    }

    let cancelled = false;
    setSelectedPrompt(null);
    setTranslation(null);
    fetch(apiUrl(`/prompts/${selectedId}`))
      .then((response) => {
        if (!response.ok) throw new Error("读取提示词内容失败");
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setSelectedPrompt(payload);
      })
      .catch((error) => {
        if (!cancelled) setStatus({ type: "error", text: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || previewMode !== "bilingual") return;

    let cancelled = false;
    setTranslation(null);
    fetch(apiUrl(`/prompts/${selectedId}/translate`))
      .then((response) => {
        if (!response.ok) throw new Error("生成中文对照失败");
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setTranslation(payload);
      })
      .catch((error) => {
        if (!cancelled) setTranslation({ error: error.message, blocks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [previewMode, selectedId]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    const needle = normalize(query);
    return data.items.filter((item) => {
      if (activePurpose !== ALL_PURPOSES && item.purposeKey !== activePurpose) return false;
      if (activeSource !== ALL_SOURCES && item.group !== activeSource) return false;
      if (showRecentOnly && !item.recentDate) return false;
      if (!needle) return true;

      const haystack = normalize(
        [
          item.title,
          item.group,
          item.subgroup,
          item.purposeLabel,
          item.purposeDescription,
          item.relativePath,
          item.excerpt,
          item.recentLabel
        ].join(" ")
      );
      return haystack.includes(needle);
    });
  }, [activePurpose, activeSource, data, query, showRecentOnly]);

  useEffect(() => {
    if (!data) return;
    if (filteredItems.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (selectedId && !filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
  }, [data, filteredItems, selectedId]);

  const sourceFilters = useMemo(() => {
    if (!data) return [];
    const sourceMap = new Map();
    for (const item of data.items) {
      if (activePurpose !== ALL_PURPOSES && item.purposeKey !== activePurpose) continue;
      sourceMap.set(item.group, (sourceMap.get(item.group) || 0) + 1);
    }
    return Array.from(sourceMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [activePurpose, data]);

  const stats = useMemo(() => {
    if (!data) return { purposeGroups: 0, recent: 0 };
    return {
      purposeGroups: data.purposeGroups?.length || 0,
      recent: data.items.filter((item) => item.recentDate).length
    };
  }, [data]);

  async function updateRepository() {
    if (STATIC_API) {
      setStatus({ type: "ready", text: "GitHub Pages 静态部署：重新运行 Actions 可刷新最新提示词" });
      return;
    }
    setStatus({ type: "loading", text: "正在拉取远程仓库并重新索引" });
    try {
      const response = await fetch("/api/update", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.message || "更新失败");

      startTransition(() => {
        setData(payload.index);
        setSelectedId(null);
        setActivePurpose(ALL_PURPOSES);
        setActiveSource(ALL_SOURCES);
        setQuery("");
      });

      setStatus({
        type: "ready",
        text: payload.changed
          ? `已更新到 ${payload.after}，当前 ${payload.index.total} 个文件`
          : `已是最新版本，当前 ${payload.index.total} 个文件`
      });
    } catch (error) {
      setStatus({ type: "error", text: error.message });
    }
  }

  async function copyPrompt() {
    if (!selectedPrompt?.content) return;
    await navigator.clipboard.writeText(selectedPrompt.content);
    setStatus({ type: "ready", text: "已复制当前提示词原文" });
  }

  async function saveTranslationBlocks(blocks) {
    if (!selectedId) return;
    if (STATIC_API) {
      throw new Error("GitHub Pages 静态部署无法保存，请在本地运行后编辑。");
    }

    const response = await fetch(apiUrl(`/prompts/${selectedId}/translate`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || payload.message || "保存中文译文失败");
    }

    setTranslation(payload);
    setStatus({ type: "ready", text: `中文译文已保存到 ${payload.cachePath}` });
  }

  function choosePurpose(purposeKey) {
    setActivePurpose(purposeKey);
    setActiveSource(ALL_SOURCES);
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div>
          <div className="eyebrow">
            <Sparkle size={16} weight="fill" />
            <span>System Prompts Leaks</span>
          </div>
          <h1>系统提示词浏览器</h1>
          <p>按用途分类筛选系统提示词，用中文解释每类用途，并提供完整分段中英对照阅读。</p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" onClick={updateRepository} disabled={status.type === "loading"}>
            <ArrowClockwise size={18} weight="bold" />
            {status.type === "loading" ? "更新中" : "更新仓库"}
          </button>
          <a className="secondary-button" href={data?.repoUrl} target="_blank" rel="noreferrer">
            <ArrowSquareOut size={18} />
            GitHub
          </a>
        </div>
      </section>

      <section className="metrics" aria-label="索引统计">
        <div>
          <span>{data?.total ?? "..."}</span>
          <p>提示词文件</p>
        </div>
        <div>
          <span>{stats.purposeGroups}</span>
          <p>用途分类</p>
        </div>
        <div>
          <span>{stats.recent}</span>
          <p>README 最近更新</p>
        </div>
        <div>
          <span>{data?.head || "..."}</span>
          <p>当前提交 {data?.headDate ? formatDate(data.headDate) : ""}</p>
        </div>
      </section>

      <section className="toolbar" aria-label="筛选工具栏">
        <label className="search-box">
          <MagnifyingGlass size={20} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索用途、模型、产品、路径或提示词摘要"
          />
        </label>
        <button
          className={showRecentOnly ? "toggle active" : "toggle"}
          onClick={() => setShowRecentOnly((value) => !value)}
        >
          <CheckCircle size={18} />
          最近更新
        </button>
        <div className={`sync-status ${status.type}`}>
          <span />
          {status.text}
        </div>
      </section>

      <section className="workbench">
        <aside className="group-panel" aria-label="用途分类">
          <div className="panel-title">
            <SidebarSimple size={18} />
            <span>用途分类</span>
          </div>
          <button
            className={activePurpose === ALL_PURPOSES ? "group-button purpose-button active" : "group-button purpose-button"}
            onClick={() => choosePurpose(ALL_PURPOSES)}
          >
            <span>
              <strong className="purpose-name">全部用途</strong>
              <em>展示仓库内全部提示词。</em>
            </span>
            <b>{data?.total ?? 0}</b>
          </button>
          {data?.purposeGroups?.map((group) => (
            <button
              key={group.key}
              className={activePurpose === group.key ? "group-button purpose-button active" : "group-button purpose-button"}
              onClick={() => choosePurpose(group.key)}
            >
              <span>
                <strong className="purpose-name">{group.label}</strong>
                <em>{group.description}</em>
              </span>
              <b>{group.count}</b>
            </button>
          ))}
        </aside>

        <section className="results-panel" aria-label="提示词列表">
          <div className="panel-heading">
            <div>
              <div className="panel-title">
                <FileText size={18} />
                <span>提示词</span>
              </div>
              <p>{filteredItems.length} 个匹配项</p>
            </div>
            <div className="subgroup-tabs">
              <button className={activeSource === ALL_SOURCES ? "active" : ""} onClick={() => setActiveSource(ALL_SOURCES)}>
                全部来源
              </button>
              {sourceFilters.slice(0, 10).map((source) => (
                <button
                  key={source.name}
                  className={activeSource === source.name ? "active" : ""}
                  onClick={() => setActiveSource(source.name)}
                >
                  {source.name} <span>{source.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="prompt-list">
            {!data && <EmptyState title="正在读取仓库" detail="首次索引需要读取本地文件和 Git 元信息。" />}
            {data && filteredItems.length === 0 && (
              <EmptyState title="没有匹配结果" detail="调整关键词、用途分类、来源或关闭最近更新筛选。" />
            )}
            {filteredItems.map((item) => (
              <button
                key={item.id}
                className={selectedId === item.id ? "prompt-card active" : "prompt-card"}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="card-kicker">
                  {item.purposeLabel} / {item.group}
                  {item.subgroup ? ` / ${item.subgroup}` : ""}
                </span>
                <strong>{item.title}</strong>
                <p>{item.excerpt || "该文件没有可抽取的摘要内容。"}</p>
                <span className="card-meta">
                  <Rows size={15} />
                  {item.lineCount} 行
                  <BracketsCurly size={15} />
                  {item.extension}
                  <GlobeHemisphereEast size={15} />
                  {item.recentDate || formatDate(item.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className="preview-panel" aria-label="提示词预览">
          {selectedPrompt ? (
            <>
              <div className="preview-header">
                <div>
                  <span className="card-kicker">{selectedPrompt.relativePath}</span>
                  <h2>{selectedPrompt.title}</h2>
                  <p className="purpose-summary">
                    {selectedPrompt.purposeLabel}：{selectedPrompt.purposeDescription}
                  </p>
                </div>
                <div className="preview-actions">
                  <button
                    className={previewMode === "bilingual" ? "active" : ""}
                    onClick={() => setPreviewMode("bilingual")}
                    aria-label="中英对照"
                    title="中英对照"
                  >
                    <TextColumns size={18} />
                  </button>
                  <button
                    className={previewMode === "source" ? "active" : ""}
                    onClick={() => setPreviewMode("source")}
                    aria-label="完整原文"
                    title="完整原文"
                  >
                    <FileText size={18} />
                  </button>
                  <button onClick={copyPrompt} aria-label="复制原文" title="复制原文">
                    <Copy size={18} />
                  </button>
                  <a href={selectedPrompt.githubUrl} target="_blank" rel="noreferrer" aria-label="打开源文件" title="打开源文件">
                    <ArrowSquareOut size={18} />
                  </a>
                </div>
              </div>
              <div className="preview-meta">
                <span>{selectedPrompt.group}</span>
                <span>{selectedPrompt.purposeLabel}</span>
                <span>{formatBytes(selectedPrompt.size)}</span>
                <span>{selectedPrompt.lineCount} 行</span>
                <span>{selectedPrompt.recentDate || formatDate(selectedPrompt.updatedAt)}</span>
              </div>
              {selectedPrompt.recentLabel && (
                <div className="recent-note">README 最近更新：{selectedPrompt.recentLabel}</div>
              )}
              <BilingualPreview
                prompt={selectedPrompt}
                translation={translation}
                mode={previewMode}
                canEditTranslation={!STATIC_API}
                onSaveTranslation={saveTranslationBlocks}
              />
            </>
          ) : (
            <EmptyState title="选择一个提示词" detail="左侧列表会显示按用途筛选后的文件，点击即可预览内容。" />
          )}
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
