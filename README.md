<div align="center">
  <img src="crawfish-avatar.png" alt="Pipi-Shrimp Agent Avatar" width="120" />

  <h1>Pipi-Shrimp Agent (皮皮虾助手)</h1>

  <p><strong>A blazingly fast, lightweight, and high-performance AI personal assistant built with Tauri + React + TypeScript.</strong></p>

  <p>
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-v1.5-24C8DB?logo=tauri&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-v18-61DAFB?logo=react&logoColor=white" />
    <img alt="Rust" src="https://img.shields.io/badge/Rust-v1.70+-000000?logo=rust&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-v5-3178C6?logo=typescript&logoColor=white" />
    <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-v3-06B6D4?logo=tailwindcss&logoColor=white" />
  </p>

  <p>
    <a href="#english">English</a> | <a href="#中文">简体中文</a>
  </p>
</div>

---

<h2 id="english">🇨🇦 English</h2>

### ✨ Core Features

Pipi-Shrimp Agent aims to provide individuals with a fast, responsive, and powerful local AI client, fully unlocking the tool-calling potential of large language models.

- **⚡ Extremely Lightweight & Native Performance**: Powered by a Rust and Tauri backend, it boasts instantaneous startup times and minimal memory footprint, while retaining full system-level execution capabilities.
- **🧠 Powerful LLM Integration (Multi-Provider)**: Deeply integrated with Claude SDK, supporting **MiniMax**, **OpenAI-compatible**, **Gemini** and **Anthropic** APIs with real-time streaming output and robust `tool_calls` functionality.
- **🛠️ Rich Local Toolchain (Function Calling)**:
  - **Code Execution Engine**: Execute Bash, Python, and Node.js scripts locally directly from the AI prompt.
  - **File System Operations**: Powerful local file reading, writing, searching, and management capabilities.
  - **Web Automation**: Integrated web browsing, scraping, and automated browser control powered by high-performance CDP (Chrome DevTools Protocol) implementations.
  - **Advanced Document Rendering**: Exclusively integrates the **Typst** engine, supporting real-time rendering of text to high-quality SVG/PDF layouts with complete font management.
- **🔄 Workflow System**: Flexible stream-based task management with visual graph editor, allowing multi-step complex operations to be executed automatically with sequential/parallel execution and conditional routing.
- **📂 Project-Level Context Management**: Intelligently manages conversation history for different projects and sessions (backed by a local SQLite database), keeping your thoughts organized and isolating contexts for different tasks. It also features a **Long-term Project Memory System** that autonomously manages and injects a `.pipi-shrimp/core.md` context file for each workspace, ensuring the AI persistently remembers the project's unique tech stack, architecture, and developer preferences across sessions.
- **🤖 Multi-Agent Collaboration (Swarm)**: Team-based autonomous agents with async inbox messaging, task distribution, permission delegation, and full transcript logging for complex collaborative tasks.
- **📦 3-Layer Context Compression**: Intelligent conversation management with microcompact (per-turn tool cleanup), session memory, and full LLM summary compression to handle long conversations efficiently.
- **💬 Telegram Bot Integration**: Connect your agent to Telegram for remote control and notifications through a bot API.
- **🧩 Rich Skill Plugins (Skill Market)**: Built-in, out-of-the-box utility components (PDF analysis, Excel processing, Docx extraction, Email, etc.).

### 🚀 Getting Started

#### 1. Prerequisites

Ensure your development environment has the following tools installed:
- **Node.js** >= 18 (Recommended >= 24)
- **pnpm** (or npm/yarn)
- **Rust** runtime (installed via [rustup](https://rustup.rs/))
- **Tauri Dependencies**: Please refer to the [official Tauri documentation](https://tauri.app/v1/guides/getting-started/prerequisites) to install system-specific build dependencies.

#### 2. Install & Run

```bash
# Clone the repository
# git clone https://github.com/your-repo/pipi-shrimp-agent.git
# cd pipi-shrimp-agent

# Install frontend and Node dependencies
pnpm install

# Start the development server (automatically launches React frontend and Tauri backend)
pnpm run tauri:dev
```

#### 3. Build Release

```bash
# Build the installer for the current operating system
pnpm run tauri:build
```

### 📂 Project Structure

This project adopts a typical frontend-backend separation architecture (based on Tauri IPC):

```text
pipi-shrimp-agent/
├── src/                         # ⚛️ React Frontend (UI + Business Logic)
│   ├── components/               # Reusable UI components
│   │   ├── workflow/            # Workflow canvas, agent nodes, execution bar
│   │   └── ...
│   ├── core/                    # QueryEngine, stream adapter, core types
│   ├── hooks/                   # Custom React hooks
│   ├── layout/                  # App layout with sidebar navigation
│   ├── pages/                   # Main pages (Chat, Workflow, Skill, Settings)
│   ├── services/                # Core services
│   │   ├── swarm/              # Multi-agent collaboration system
│   │   ├── compact/             # 3-layer context compression
│   │   ├── memory/              # Long-term memory & auto-extraction
│   │   ├── toolEngine.ts        # Tool execution orchestration
│   │   ├── workflowEngine.ts    # Visual workflow orchestration
│   │   └── telegramService.ts   # Telegram Bot integration
│   ├── skills/                  # Skill plugins (PDF, DOCX, XLSX, Email)
│   ├── store/                   # Zustand state management
│   ├── tools/                   # Tool implementations (Bash, File, Browser, etc.)
│   ├── types/                   # TypeScript type definitions
│   └── utils/                   # Utilities (pricing, permissions, browser utils)
├── src-tauri/                   # 🦀 Rust Backend (Native Core)
│   ├── src/
│   │   ├── lib.rs               # Main library with 60+ Tauri commands
│   │   ├── database.rs          # SQLite persistence layer
│   │   ├── claude/              # Claude API HTTP client (multi-provider)
│   │   ├── models/              # IPC request/response types
│   │   ├── tools/                # Tool pipeline registry & scheduler
│   │   └── utils/                # Typst rendering, error handling
│   ├── skills/                  # Skill metadata (skills.config.json)
│   ├── capabilities/            # Tauri permission configurations
│   ├── Cargo.toml               # Rust dependencies
│   └── tauri.conf.json          # Tauri application config
├── docs/                        # Documentation
├── public/                      # Static assets
└── package.json                 # Frontend dependencies
```

### 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Zustand, Vite
- **Backend**: Rust, Tauri 2, Tokio (Async Runtime), Rusqlite (SQLite Driver), Typst (Document Rendering), Chromiumoxide (CDP)
- **AI Engine**: Anthropic API / Claude SDK (multi-provider: MiniMax, OpenAI-compatible, Gemini)
- **Tools**: pnpm, Cargo

### 📝 Roadmap

- [x] Task 1: Core framework initialization (Tauri + React)
- [x] Task 2: Lightweight state management (Zustand)
- [x] Task 3: Claude SDK integration & optimizer (tool calls & streaming)
- [x] Task 4: **Workflow streaming system**
- [x] Task 5: **Project-level conversation context management** (SQLite storage)
- [x] Task 6: Deep integration with Typst typesetting & rendering engine
- [x] Task 7: Core local system operation commands (Bash/Node/Python/File System)
- [x] Task 8: **Agent Long-term Project Memory System** (`.pipi-shrimp/core.md`)
- [x] Task 9: **High-performance CDP-based Browser Automation Agent**
- [x] Task 10: **Multi-Agent Collaboration System (Swarm)**
- [x] Task 11: **3-Layer Context Compression** (microcompact, session memory, full compact)
- [x] Task 12: **Telegram Bot Integration**
- [ ] Task 13: Knowledge base (RAG) retrieval augmentation integration
- [ ] Task 14: Font selection feature for Typst rendering

### 🔧 Recommended IDE Setup

We highly recommend using **VS Code** for development and installing the following extensions for the best experience:
- [Tauri VSCode Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

---

<h2 id="中文">🇨🇳 简体中文</h2>

### ✨ 核心特性

Pipi-Shrimp Agent 旨在为个人提供一个快速、响应迅速且功能强大的本地 AI 客户端，彻底释放大语言模型的工具调用潜力。

- **⚡ 极致轻量与原生性能**: 基于 Rust 和 Tauri 构建后端，极速启动，内存占用极低，同时提供系统底层调用权限。
- **🧠 强大的大模型集成 (多 Provider)**: 深度集成 Claude SDK，支持 **MiniMax**、**OpenAI-compatible**、**Gemini** 及 **Anthropic** API，流式输出与 `tool_calls` 工具调用能力。
- **🛠️ 丰富的本地化工具链 (Function Calling)**:
  - **代码执行引擎**: 本地执行 Bash, Python, 和 Node.js 脚本。
  - **文件系统操作**: 强大的本地文件读写、搜索与管理能力。
  - **Web 自动化**: 集成网页浏览、抓取和基于 CDP 的高性能端到端浏览器自动化智能控制方案。
  - **高级文档渲染**: 独家集成 **Typst** 引擎，支持从文本到高质量 SVG/PDF 排版的实时渲染与字体管理。
- **🔄 Workflow 工作流系统**: 灵活的可视化图形编排任务管理，支持顺序/并行执行与条件路由，让多步骤复杂操作自动化执行。
- **📂 项目级上下文管理**: 智能管理不同项目和会话的对话历史 (基于本地 SQLite 数据库)，保持思路清晰，隔离不同任务的上下文。独创 **项目级核心长效记忆系统**，自动维护 `.pipi-shrimp/core.md` 文件，使 AI 能跨会话持久地记住项目的技术栈、架构背景及你的私人开发偏好。
- **🤖 多智能体协作 (Swarm)**: 基于团队协作的自主智能体系统，支持异步消息传递、任务分发、权限委托和完整 transcript 日志记录。
- **📦 三层上下文压缩**: 智能对话管理，包含 microcompact（每轮工具清理）、session memory 和完整 LLM 摘要压缩，高效处理长对话。
- **💬 Telegram 机器人集成**: 通过 Bot API 连接你的智能体，实现远程控制和消息通知。
- **🧩 丰富的技能插件 (Skill Market)**: 内置多种开箱即用的实用工具组件（PDF 分析、Excel 处理、Docx 提取、Email 等）。

### 🚀 快速开始

#### 1. 前置要求

确保你的开发环境已安装以下工具：
- **Node.js** >= 18 (推荐 >= 24)
- **pnpm** (或 npm/yarn)
- **Rust** 运行环境 (通过 [rustup](https://rustup.rs/) 安装)
- **Tauri 依赖**: 请参考 [Tauri 官方文档](https://tauri.app/v1/guides/getting-started/prerequisites) 安装系统特定的构建依赖。

#### 2. 安装和运行

```bash
# 克隆仓库
# git clone https://github.com/your-repo/pipi-shrimp-agent.git
# cd pipi-shrimp-agent

# 安装前端和 Node 依赖
pnpm install

# 启动开发服务器 (自动启动 React 前端和 Tauri 后端)
pnpm run tauri:dev
```

#### 3. 构建发布版本

```bash
# 打包构建适用于当前操作系统的安装包
pnpm run tauri:build
```

### 📂 项目结构

该项目采用典型的前后端分离（基于 Tauri IPC）架构：

```text
pipi-shrimp-agent/
├── src/                         # ⚛️ React 前端代码 (UI + 业务逻辑)
│   ├── components/               # 可复用 UI 组件
│   │   ├── workflow/            # 工作流画布、节点、执行栏
│   │   └── ...
│   ├── core/                    # QueryEngine, 流适配器, 核心类型
│   ├── hooks/                   # 自定义 React hooks
│   ├── layout/                  # 带侧边栏导航的布局
│   ├── pages/                   # 核心页面 (Chat, Workflow, Skill, Settings)
│   ├── services/                # 核心服务
│   │   ├── swarm/              # 多智能体协作系统
│   │   ├── compact/             # 三层上下文压缩
│   │   ├── memory/              # 长期记忆与自动提取
│   │   ├── toolEngine.ts        # 工具执行编排
│   │   ├── workflowEngine.ts     # 可视化工作流编排
│   │   └── telegramService.ts    # Telegram 机器人集成
│   ├── skills/                  # 技能插件 (PDF, DOCX, XLSX, Email)
│   ├── store/                   # Zustand 状态管理
│   ├── tools/                   # 工具实现 (Bash, File, Browser 等)
│   ├── types/                   # TypeScript 类型定义
│   └── utils/                   # 工具函数 (定价, 权限, 浏览器工具)
├── src-tauri/                   # 🦀 Rust 后端代码 (原生核心)
│   ├── src/
│   │   ├── lib.rs               # 主库，包含 60+ 个 Tauri 命令
│   │   ├── database.rs          # SQLite 持久化层
│   │   ├── claude/              # Claude API HTTP 客户端 (多 provider)
│   │   ├── models/              # IPC 请求/响应类型
│   │   ├── tools/                # 工具管道注册与调度
│   │   └── utils/                # Typst 渲染, 错误处理
│   ├── skills/                  # 技能元数据 (skills.config.json)
│   ├── capabilities/            # Tauri 权限配置
│   ├── Cargo.toml               # Rust 依赖
│   └── tauri.conf.json          # Tauri 应用配置
├── docs/                        # 文档
├── public/                      # 静态资源
└── package.json                  # 前端依赖
```

### 🛠️ 技术栈

- **前端 (Frontend)**: React 18, TypeScript, Tailwind CSS, Zustand, Vite
- **后端 (Backend)**: Rust, Tauri 2, Tokio (异步运行时), Rusqlite (SQLite 驱动), Typst (文档渲染), Chromiumoxide (CDP)
- **AI 引擎 (AI)**: Anthropic API / Claude SDK (多 provider: MiniMax, OpenAI-compatible, Gemini)
- **工具 (Tools)**: pnpm, Cargo

### 📝 开发进度

- [x] Task 1: 核心框架初始化 (Tauri + React)
- [x] Task 2: 轻量级状态管理实现 (Zustand)
- [x] Task 3: Claude SDK 集成与优化器 (支持工具调用与流式响应)
- [x] Task 4: **Workflow 流式系统**
- [x] Task 5: **项目级对话上下文管理** (SQLite 本地存储)
- [x] Task 6: Typst 排版与渲染引擎深度整合
- [x] Task 7: 核心本地系统操作指令集 (Bash/Node/Python/文件系统)
- [x] Task 8: ** Agent 项目级长效记忆体系** (`.pipi-shrimp/core.md`)
- [x] Task 9: **基于 CDP 的高性能浏览器智能控制能力**
- [x] Task 10: **多智能体协作系统 (Swarm)**
- [x] Task 11: **三层上下文压缩系统** (microcompact, session memory, full compact)
- [x] Task 12: **Telegram 机器人集成**
- [ ] Task 13: 知识库 (RAG) 检索增强集成
- [ ] Task 14: 字体选择功能 (允许用户为 Typst 渲染选择首选字体)

### 🔧 IDE 推荐配置

强烈推荐使用 **VS Code** 进行开发，并安装以下扩展以获得最佳体验：
- [Tauri VSCode 扩展](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

---

## 🙏 Thanks & Acknowledgments

### Resume Template Credits

The built-in resume skill includes templates from the following open-source [Typst Universe](https://typst.app/universe) packages. Full license files are included alongside each template in `src/skills/resume/templates/`.

| Template | Author | License | Link |
|----------|--------|---------|------|
| **basic-resume** | Stephen Xu | Unlicense (Public Domain) | [typst.app/universe/package/basic-resume](https://typst.app/universe/package/basic-resume) |
| **brilliant-cv** | Yunan Wang | Apache 2.0 | [typst.app/universe/package/brilliant-cv](https://typst.app/universe/package/brilliant-cv) |
| **calligraphics** | Lieunoir | MIT | [typst.app/universe/package/calligraphics](https://typst.app/universe/package/calligraphics) |
| **grotesk-cv** | Jesper Dramsch | Unlicense (Public Domain) | [typst.app/universe/package/grotesk-cv](https://typst.app/universe/package/grotesk-cv) |
| **nabcv** | Resul | MIT | [typst.app/universe/package/nabcv](https://typst.app/universe/package/nabcv) |

### Open Source Inspiration

- **[LobsterAI](https://lobsterai.youdao.com/#/en/index)** - Provides architectural inspiration and reference for our agent system
- **[PageAgent](https://github.com/alibaba/page-agent)** by Alibaba

### Project License

This project is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).

### Sponsors


**MiniMax** generously sponsors this project with API credits and technical support for AI capabilities.

---

*If you find this project helpful, consider giving it a star! 🌟*
