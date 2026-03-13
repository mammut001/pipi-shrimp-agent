# Tauri AI Agent

一个轻量级的 AI 个人助手，基于 Tauri + React + TypeScript。

## 🚀 快速开始

### 前置要求
- Node.js >= 24 < 25
- pnpm (或 npm)
- Rust (通过 Tauri 安装)

### 安装和运行

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发服务器
pnpm run tauri:dev

# 3. 构建生产版本
pnpm run tauri:build
```

### 可用脚本

- `pnpm dev` - 启动 Vite 开发服务器 (port 5173)
- `pnpm build` - TypeScript 编译 + Vite 打包
- `pnpm tauri:dev` - 启动 Tauri 应用 + 热重载
- `pnpm tauri:build` - 打包发布版本

## 📂 项目结构

```
src/              # React 前端代码
src-tauri/        # Rust 后端代码
├─ src/
│  ├─ main.rs    # 应用入口
│  └─ lib.rs     # Tauri Builder 配置
├─ Cargo.toml    # Rust 依赖
└─ tauri.conf.json # Tauri 配置
```

## 🛠️ 技术栈

- **前端**: React 18 + TypeScript + Tailwind CSS
- **状态管理**: Zustand
- **后端**: Rust + Tauri
- **构建工具**: Vite
- **异步运行时**: Tokio
- **IM 集成**: Grammy (Telegram)

## 📝 开发进度

- ✅ Task 1.1: Tauri 项目初始化 + 基础配置
- ⏳ Task 1.2: Zustand 状态管理
- ⏳ Task 1.3: 基础 React UI
- ⏳ Task 1.4: Rust 命令框架
- ⏳ Task 2.1: Claude SDK 集成
- ... (更多 Tasks)

## 🔧 IDE 推荐配置

- [VS Code](https://code.visualstudio.com/)
- [Tauri VSCode 扩展](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
