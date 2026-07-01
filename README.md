# System Prompts Browser

一个本地 Web UI，用于浏览 `asgeirtj/system_prompts_leaks` 中的系统提示词。

## 功能

- 按提示词正文内容进行用途分类
- 按来源、关键词和最近更新筛选
- 中英文分段对照阅读
- 一键拉取上游仓库最新提示词
- 三栏独立滚动，页面整体可正常滚动

## 启动

```bash
npm install
npm run start
```

默认访问地址：

```text
http://127.0.0.1:4177
```

首次启动会自动克隆提示词仓库到 `data/system_prompts_leaks`。

## GitHub Pages 部署

推送到 `main` 后，GitHub Actions 会自动构建并部署到 GitHub Pages。

静态部署不运行 Express 服务。构建流程会在 Actions 中克隆上游提示词仓库，并生成 `dist/api` 静态 JSON 文件供前端读取。

如需刷新 GitHub Pages 上的提示词数据，进入仓库的 Actions 页面，手动重新运行 `Deploy to GitHub Pages` 工作流即可。
