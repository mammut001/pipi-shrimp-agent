# Pipi-Shrimp Agent (皮皮虾助手)

一个**极致轻量级**、**高性能**的 AI 个人助手，基于 Tauri + React + TypeScript 打造。

### ✨ 核心特性

- **极致轻量**: 极速启动，内存占用极低，专注于核心效率工具。
- **现代化架构**: 基于 Rust (Tauri) 后端，提供原生级性能与安全性。
- **Workflow 系统**: 灵活的流式任务管理，让复杂操作自动化。
- **项目级上下文**: 智能管理不同项目的对话上下文，保持思路清晰。

## 🚀 快速开始

### 前置要求
- Node.js >= 24
- pnpm (或 npm)
- Rust (通过 Tauri 安装)

### 安装和运行

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发服务器
pnpm run tauri:dev
```

## 📂 项目结构

```
src/              # React 前端 (轻量 UI 交互)
src-tauri/        # Rust 后端 (高性能运行时)
├─ src/           # 核心逻辑
└─ tauri.conf.json # 配置
```

## 🛠️ 技术栈

- **前端**: React 18 + TypeScript + Tailwind CSS
- **状态管理**: Zustand (轻量级状态管理)
- **后端**: Rust + Tauri
- **构建工具**: Vite
- **AI 集成**: Claude SDK (已优化工具调用)

## 📝 进度

- ✅ Task 1: 核心框架初始化 (Tauri + React)
- ✅ Task 2: 轻量级状态管理实现 (Zustand)
- ✅ Task 3: Claude SDK 集成与优化器
- ✅ Task 4: **Workflow 流式系统** (New)
- ✅ Task 5: **项目级对话上下文管理** (New)
- ⏳ Task 6: 更多自动化插件支持

## 🔧 IDE 推荐配置

- [VS Code](https://code.visualstudio.com/)
- [Tauri VSCode 扩展](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
