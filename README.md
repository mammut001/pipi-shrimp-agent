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
- **🧠 Powerful LLM Integration (Claude-First)**: Deeply integrated with the Claude SDK, supporting real-time streaming output and robust `tool_calls` functionality.
- **🛠️ Rich Local Toolchain (Function Calling)**:
  - **Code Execution Engine**: Execute Bash, Python, and Node.js scripts locally directly from the AI prompt.
  - **File System Operations**: Powerful local file reading, writing, searching, and management capabilities.
  - **Web Automation**: Integrated web browsing, scraping, and automated browser control.
  - **Advanced Document Rendering**: Exclusively integrates the **Typst** engine, supporting real-time rendering of text to high-quality SVG/PDF layouts with complete font management.
- **🔄 Workflow System**: Flexible stream-based task management, allowing multi-step complex operations to be executed automatically.
- **📂 Project-Level Context Management**: Intelligently manages conversation history for different projects and sessions (backed by a local SQLite database), keeping your thoughts organized and isolating contexts for different tasks.
- **🧩 Rich Skill Plugins (Skill Market)**: Built-in, out-of-the-box utility components (PDF analysis, Excel processing, Docx extraction, etc.).

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
├── src/                    # ⚛️ React Frontend (UI Interactions)
│   ├── components/         # Reusable UI components
│   ├── pages/              # Core pages (Chat, Workflow, Settings, Skill)
│   ├── store/              # Zustand state management (ChatStore, UIStore, Settings)
│   ├── skills/             # Pre-built feature modules (PDF/Docx/Email/Xlsx processing)
│   └── types/              # TypeScript type definitions
├── src-tauri/              # 🦀 Rust Backend (Core Logic)
│   ├── src/                #
│   │   ├── commands/       # Tauri command registration (exposed to frontend)
│   │   │   ├── chat.rs     # Session logic
│   │   │   ├── code.rs     # Script execution logic (Bash/Python/Node)
│   │   │   ├── file.rs     # Local file operations
│   │   │   └── web.rs      # Web automation
│   │   ├── claude/         # Claude API client implementation
│   │   ├── models/         # Data models and serialization
│   │   ├── utils/          # Utilities (Typst rendering, font management)
│   │   ├── database.rs     # SQLite local persistence logic
│   │   └── main.rs         # Tauri application entry point
│   ├── Cargo.toml          # Rust dependencies configuration
│   └── tauri.conf.json     # Tauri application configuration
├── node-scripts/           # 🟢 Node scripts called by the Rust backend (e.g., claude-sdk.js)
├── public/                 # Static assets (e.g., icons)
└── package.json            # Frontend and project-level dependencies
```

### 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Zustand, Vite
- **Backend**: Rust, Tauri, Tokio (Async Runtime), Rusqlite (SQLite Driver), Typst (Document Rendering)
- **AI Engine**: Anthropic API / Claude SDK
- **Tools**: pnpm, Cargo

### 📝 Roadmap

- [x] Task 1: Core framework initialization (Tauri + React)
- [x] Task 2: Lightweight state management (Zustand)
- [x] Task 3: Claude SDK integration & optimizer (tool calls & streaming)
- [x] Task 4: **Workflow streaming system**
- [x] Task 5: **Project-level conversation context management** (SQLite storage)
- [x] Task 6: Deep integration with Typst typesetting & rendering engine
- [x] Task 7: Core local system operation commands (Bash/Node/Python/File System)
- [ ] Task 8: More automated plugins and third-party API extension support
- [ ] Task 9: Knowledge base (RAG) retrieval augmentation integration
- [ ] Task 10: Font selection feature for Typst rendering (allow users to choose preferred fonts)

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
- **🧠 强大的大模型集成 (Claude 优先)**: 深度集成 Claude SDK，支持流式输出 (Streaming) 和强大的 `tool_calls` 工具调用能力。
- **🛠️ 丰富的本地化工具链 (Function Calling)**:
  - **代码执行引擎**: 本地执行 Bash, Python, 和 Node.js 脚本。
  - **文件系统操作**: 强大的本地文件读写、搜索与管理能力。
  - **Web 自动化**: 集成网页浏览、抓取和自动化控制。
  - **高级文档渲染**: 独家集成 **Typst** 引擎，支持从文本到高质量 SVG/PDF 排版的实时渲染与字体管理。
- **🔄 Workflow 工作流系统**: 灵活的流式任务管理，让多步骤的复杂操作自动化执行。
- **📂 项目级上下文管理**: 智能管理不同项目和会话的对话历史 (基于本地 SQLite 数据库)，保持思路清晰，隔离不同任务的上下文。
- **🧩 丰富的技能插件 (Skill Market)**: 内置多种开箱即用的实用工具组件（PDF 分析、Excel 处理、Docx 提取等）。

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

### 🛠️ 技术栈

- **前端 (Frontend)**: React 18, TypeScript, Tailwind CSS, Zustand, Vite
- **后端 (Backend)**: Rust, Tauri, Tokio (异步运行时), Rusqlite (SQLite 驱动), Typst (文档渲染)
- **AI 引擎 (AI)**: Anthropic API / Claude SDK
- **工具 (Tools)**: pnpm, Cargo

### 📝 开发进度

- [x] Task 1: 核心框架初始化 (Tauri + React)
- [x] Task 2: 轻量级状态管理实现 (Zustand)
- [x] Task 3: Claude SDK 集成与优化器 (支持工具调用与流式响应)
- [x] Task 4: **Workflow 流式系统**
- [x] Task 5: **项目级对话上下文管理** (SQLite 本地存储)
- [x] Task 6: Typst 排版与渲染引擎深度整合
- [x] Task 7: 核心本地系统操作指令集 (Bash/Node/Python/文件系统)
- [ ] Task 8: 更多自动化插件与第三方 API 扩展支持
- [ ] Task 9: 知识库 (RAG) 检索增强集成
- [ ] Task 10: 字体选择功能 (允许用户为 Typst 渲染选择首选字体)

### 🔧 IDE 推荐配置

强烈推荐使用 **VS Code** 进行开发，并安装以下扩展以获得最佳体验：
- [Tauri VSCode 扩展](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

---

## 🙏 Thanks & Acknowledgments

### Open Source Inspiration

- **[LobsterAI](https://lobsterai.youdao.com/#/en/index)** - Provides architectural inspiration and reference for our agent system
- **[PageAgent](https://github.com/alibaba/page-agent)** by Alibaba
### Sponsors


**MiniMax** generously sponsors this project with API credits and technical support for AI capabilities.

---

*If you find this project helpful, consider giving it a star! 🌟*
