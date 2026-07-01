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

function BilingualPreview({ prompt, translation, mode }) {
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

  return (
    <div className="bilingual-view">
      <div className="language-head">
        <span>English Original</span>
        <span>
          中文对照
          {translation.failedBlocks ? `，${translation.failedBlocks} 段失败` : ""}
        </span>
      </div>
      {sourceBlocks.map((block, index) => {
        const translatedBlock = translatedMap.get(index);
        return (
          <article className="translation-row" key={`${block.slice(0, 24)}-${index}`}>
            <p className="original-text">{translatedBlock?.original || block}</p>
            <p className={translatedBlock?.ok === false ? "translated-text failed-copy" : "translated-text"}>
              {translatedBlock?.zh || "这一段中文翻译尚未生成。"}
            </p>
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
    fetch("/api/prompts")
      .then((response) => {
        if (!response.ok) throw new Error("读取索引失败");
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setSelectedId(payload.items[0]?.id || null);
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
    fetch(`/api/prompts/${selectedId}`)
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
    fetch(`/api/prompts/${selectedId}/translate`)
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
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0].id);
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
    setStatus({ type: "loading", text: "正在拉取远程仓库并重新索引" });
    try {
      const response = await fetch("/api/update", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || payload.message || "更新失败");

      startTransition(() => {
        setData(payload.index);
        setSelectedId(payload.index.items[0]?.id || null);
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
              <BilingualPreview prompt={selectedPrompt} translation={translation} mode={previewMode} />
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
