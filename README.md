<div align="center">
  <img src="crawfish-avatar.png" alt="Pipi-Shrimp Agent Avatar" width="120" />

  <h1>Pipi-Shrimp Agent (皮皮虾助手)</h1>

  <p><strong>一个极致轻量级、高性能的 AI 个人助手，基于 Tauri + React + TypeScript 打造。</strong></p>

  <p>
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-v1.5-24C8DB?logo=tauri&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-v18-61DAFB?logo=react&logoColor=white" />
    <img alt="Rust" src="https://img.shields.io/badge/Rust-v1.70+-000000?logo=rust&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-v5-3178C6?logo=typescript&logoColor=white" />
    <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-v3-06B6D4?logo=tailwindcss&logoColor=white" />
  </p>
</div>

---

## ✨ 核心特性 / Features

Pipi-Shrimp Agent 旨在为个人提供一个快速、响应迅速且功能强大的本地 AI 客户端，彻底释放大语言模型的工具调用潜力。

- **⚡ 极致轻量与原生性能**: 基于 Rust 和 Tauri 构建后端，极速启动，内存占用极低，同时提供系统底层调用权限。
- **🧠 强大的大模型集成 (Claude 优先)**: 深度集成 Claude SDK，支持流式输出 (Streaming) 和强大的 `tool_calls` 工具调用能力。
- **🛠️ 丰富的本地化工具链 (Function Calling)**:
  - **代码执行引擎**: 安全、沙盒化地执行 Bash, Python, 和 Node.js 脚本。
  - **文件系统操作**: 强大的本地文件读写、搜索与管理能力。
  - **Web 自动化**: 集成网页浏览、抓取和自动化控制。
  - **高级文档渲染**: 独家集成 **Typst** 引擎，支持从文本到高质量 SVG/PDF 排版的实时渲染与字体管理。
- **🔄 Workflow 工作流系统**: 灵活的流式任务管理，让多步骤的复杂操作自动化执行。
- **📂 项目级上下文管理**: 智能管理不同项目和会话的对话历史 (基于本地 SQLite 数据库)，保持思路清晰，隔离不同任务的上下文。
- **🧩 丰富的技能插件 (Skill Market)**: 内置多种开箱即用的实用工具组件（PDF 分析、Excel 处理、Docx 提取等）。

## 🚀 快速开始 / Getting Started

### 1. 前置要求 / Prerequisites

确保你的开发环境已安装以下工具：
- **Node.js** >= 18 (推荐 >= 24)
- **pnpm** (或 npm/yarn)
- **Rust** 运行环境 (通过 [rustup](https://rustup.rs/) 安装)
- **Tauri 依赖**: 请参考 [Tauri 官方文档](https://tauri.app/v1/guides/getting-started/prerequisites) 安装系统特定的构建依赖。

### 2. 安装和运行 / Install & Run

```bash
# 克隆仓库
# git clone https://github.com/your-repo/pipi-shrimp-agent.git
# cd pipi-shrimp-agent

# 安装前端和 Node 依赖
pnpm install

# 启动开发服务器 (自动启动 React 前端和 Tauri 后端)
pnpm run tauri:dev
```

### 3. 构建发布版本 / Build Release

```bash
# 打包构建适用于当前操作系统的安装包
pnpm run tauri:build
```

## 📂 项目结构 / Project Structure

该项目采用典型的前后端分离（基于 Tauri IPC）架构：

```text
pipi-shrimp-agent/
├── src/                    # ⚛️ React 前端代码 (UI 交互)
│   ├── components/         # 可复用的 UI 组件
│   ├── pages/              # 核心页面 (Chat, Workflow, Settings, Skill)
│   ├── store/              # Zustand 状态管理 (ChatStore, UIStore, Settings)
│   ├── skills/             # 预置的特色功能模块 (PDF/Docx/Email/Xlsx 处理)
│   └── types/              # TypeScript 类型定义
├── src-tauri/              # 🦀 Rust 后端代码 (核心逻辑层)
│   ├── src/                #
│   │   ├── commands/       # Tauri 命令注册 (暴露给前端调用的接口)
│   │   │   ├── chat.rs     # 会话逻辑
│   │   │   ├── code.rs     # 脚本执行逻辑 (Bash/Python/Node)
│   │   │   ├── file.rs     # 本地文件操作
│   │   │   └── web.rs      # Web 自动化相关
│   │   ├── claude/         # Claude API 客户端实现与通信层
│   │   ├── models/         # 数据模型与序列化定义
│   │   ├── utils/          # 工具类 (Typst 渲染与字体库管理等)
│   │   ├── database.rs     # SQLite 本地持久化逻辑
│   │   └── main.rs         # Tauri 应用入口
│   ├── Cargo.toml          # Rust 依赖配置
│   └── tauri.conf.json     # Tauri 应用程序配置
├── node-scripts/           # 🟢 供 Rust 后端调用的辅助 Node 脚本 (如 claude-sdk.js)
├── public/                 # 静态资源 (如图标)
└── package.json            # 前端与项目级依赖
```

## 🛠️ 技术栈 / Tech Stack

- **前端 (Frontend)**: React 18, TypeScript, Tailwind CSS, Zustand, Vite
- **后端 (Backend)**: Rust, Tauri, Tokio (异步运行时), Rusqlite (SQLite 驱动), Typst (文档渲染)
- **AI 引擎 (AI)**: Anthropic API / Claude SDK
- **工具 (Tools)**: pnpm, Cargo

## 📝 开发进度 / Roadmap

- [x] Task 1: 核心框架初始化 (Tauri + React)
- [x] Task 2: 轻量级状态管理实现 (Zustand)
- [x] Task 3: Claude SDK 集成与优化器 (支持工具调用与流式响应)
- [x] Task 4: **Workflow 流式系统**
- [x] Task 5: **项目级对话上下文管理** (SQLite 本地存储)
- [x] Task 6: Typst 排版与渲染引擎深度整合
- [x] Task 7: 核心本地系统操作指令集 (Bash/Node/Python/文件系统)
- [ ] Task 8: 更多自动化插件与第三方 API 扩展支持
- [ ] Task 9: 知识库 (RAG) 检索增强集成

## 🔧 IDE 推荐配置 / Recommended IDE Setup

强烈推荐使用 **VS Code** 进行开发，并安装以下扩展以获得最佳体验：
- [Tauri VSCode 扩展](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

---
*If you find this project helpful, consider giving it a star! 🌟*
