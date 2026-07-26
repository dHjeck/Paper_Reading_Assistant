# 论文阅读助手

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

论文阅读助手是一个 Chrome Manifest V3 扩展，帮助用户在不打断阅读流程的情况下理解学术论文。它支持解释、简化和定义选中的文字，也可以总结网页与 PDF 全文、继续追问，并保存有用的阅读结果。

## 当前实现状态

目前已经实现以下功能：

- Chrome Manifest V3 扩展，包括弹出窗口、设置页面和侧边栏。
- 文本选择浮动工具栏，支持解释、简化、定义和保存。
- 结构化结果卡片及上下文追问。
- 使用 `chrome.storage.local` 保存当前论文的收藏和阅读历史。
- 提取清理后的 HTML 并总结当前网页，转换失败时自动使用纯文本。
- 本地 PDF Workspace，支持 PDF 渲染、翻页、缩放、文本选择和全文总结。
- 使用仓库内 `html_pdf2md/markitdown` 的 MarkItDown 源码转换 HTML 和 PDF。
- Mock、真实 API 和自动回退三种请求模式。
- 支持配置 OpenAI 兼容接口的地址、模型、API Key 和输出语言。
- 英文、简体中文和日文界面。
- 后端请求校验、限流、可选 API 鉴权、请求 ID、结构化日志和敏感请求头脱敏。
- 文本、图片和全文总结请求失败后的重试处理。

> **测试状态：图片选择功能未测试。** 图片区域选择与图片解释流程已经实现，但尚未完成手动验证。

## 快速开始

### 1. 加载扩展

1. 打开 Chrome，在地址栏输入 `chrome://extensions`。
2. 打开右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择包含 `manifest.json` 的项目根目录，或者构建后的 `dist/chrome-extension`。
5. 将扩展固定到浏览器工具栏。

### 2. 启动后端

扩展默认可以使用 Mock 模式。若要调用真实模型和使用真实文档转换，请启动后端：

```powershell
cd backend
npm install
npm run setup:python
npm start
```

`npm run setup:python` 会创建 `backend/.venv`，并以 editable 模式安装仓库内的 MarkItDown 源码。

后端默认监听：

```text
http://localhost:3000
```

健康检查地址：

```text
http://localhost:3000/api/health
```

### 3. 配置扩展

打开扩展设置页面，可以配置：

- API 模式：`mock`、`real` 或 `auto`
- 后端地址
- 后端认证 Token
- OpenAI 兼容接口地址
- LLM API Key
- 模型名称
- 输出语言
- 请求超时时间

真实 API Key 保存在 Chrome 的 `chrome.storage.local` 中，不应写入源码、`.env.example`、日志或 Git 提交。

### 4. 构建扩展

在项目根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-extension.ps1
```

构建结果：

```text
dist/chrome-extension
dist/chrome-extension.zip
```

## 使用方法

### 解释文字

1. 打开论文网页或 PDF Workspace。
2. 选择至少两个字符的文字。
3. 在浮动工具栏中选择“解释”“简化”或“定义”。
4. 在侧边栏查看结构化结果。
5. 可以继续追问、保存结果或从历史记录重新打开。

### 总结网页

1. 打开包含论文正文的网页。
2. 打开扩展侧边栏。
3. 点击“总结全文”。
4. 扩展会提取清理后的 HTML，同时保留纯文本作为转换失败时的降级内容。

### 总结 PDF

1. 在 PDF Workspace 中打开本地 PDF。
2. 点击侧边栏中的“总结全文”。
3. PDF 会发送到本地后端，并通过 MarkItDown 转换为 Markdown。
4. 转换后的内容由配置的模型生成结构化摘要。

默认 PDF 文件上限为 30 MB。PDF 会在后端临时目录中短暂保存，并在转换完成或失败后清理。

## 架构概览

```text
网页 / PDF Workspace
        |
        v
Content Script / PDF Viewer
        |
        v
Background Service Worker
        |
        +--> chrome.storage.local
        |
        +--> API Client (mock / real / auto)
                    |
                    v
              Express 后端
                    |
          +---------+---------+
          |                   |
          v                   v
     MarkItDown          Mock / OpenAI
```

主要目录：

```text
src/background/   后台消息路由、状态编排和 API 客户端
src/content/      网页文本选择、正文提取和图片框选
src/pdf-viewer/   本地 PDF 阅读工作区
src/sidepanel/    侧边栏状态与界面渲染
src/options/      API 和模型设置
src/shared/       共享协议、类型、常量和国际化文本
backend/src/      Express API、模型适配器和文档转换服务
html_pdf2md/      仓库内 MarkItDown 源码
docs/             设计、协议和 QA 文档
```

## 测试

启动后端后运行：

```powershell
cd backend
node test-smoke.js
```

当前后端 Smoke Test 覆盖健康检查、文本处理、追问、错误响应、LLM 配置和文档总结。

图片选择功能尚未完成手动测试。

## 安全说明

- 不要把真实 API Key 写入源码或提交到 Git。
- `.env`、`.venv`、`node_modules`、日志和构建产物已经加入忽略规则。
- 后端日志会对 `Authorization`、`X-API-Key`、`X-LLM-Api-Key` 和 Cookie 进行脱敏。
- 如果 Key 曾出现在公开日志、聊天记录或 Git 历史中，请立即撤销并生成新 Key。

## 更多文档

- [交互规范](docs/paper-reading-assistant-interaction-spec.md)
- [侧边栏状态规范](docs/paper-reading-assistant-side-panel-state-spec.md)
- [后端 API 规范](docs/paper-reading-assistant-backend-api-spec.md)
- [QA 检查表](docs/qa-checklist.md)

## 第三方软件与致谢

本项目包含并使用 Microsoft 开源项目
[MarkItDown](https://github.com/microsoft/markitdown)，通过它将 HTML 和 PDF
文档转换为 Markdown。MarkItDown 使用 MIT 许可证。

仓库内的 MarkItDown 源码位于 `html_pdf2md/markitdown`。其原始版权声明、
许可证和第三方软件声明均保留在该目录中。详细信息请参阅
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

MarkItDown 是 Microsoft 的开源项目。Microsoft 不赞助、不背书、不维护
Paper Reading Assistant，也不为本项目提供支持。
