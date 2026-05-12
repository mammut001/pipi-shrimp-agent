# 📋 全量代码审计清单
**仓库:** `/Users/yuhansong/Documents/GitHub/pipi-shrimp-agent`  
**开始时间:** 2026年5月12日  
**状态:** 进行中

---

## 分类统计

### 1. 前端 TSX (React组件)
- **路径:** `src/**/*.tsx`, `website/src/**/*.tsx`
- **跳过:** `node_modules/`, `dist/`, `build/`, `coverage/`
- **文件数:** ~100+
- **行数:** ~32000+

### 2. 前端 TS (服务/工具/类型)
- **路径:** `src/**/*.ts` (排除tsx)
- **文件数:** ~150+
- **行数:** ~45000+

### 3. Tauri/Rust 代码
- **路径:** `src-tauri/src/**/*.rs`
- **跳过:** `src-tauri/target/`, `src-tauri/gen/`, `src-tauri/icons/`
- **文件数:** ~50+
- **行数:** ~12000+

### 4. Skills/Prompts/Templates
- **路径:** `src/skills/`, `src-tauri/skills/`
- **文件数:** ~15+ skills目录
- **行数:** ~8000+

### 5. 测试文件
- **路径:** `src/__tests__/**`, `tests/**`, `src-tauri/tests/**`
- **文件数:** ~40+
- **行数:** ~15000+

### 6. 配置文件
- **路径:** `*.json`, `*.toml`, `*.yaml`, `*.yml`, `*.config.*`
- **文件数:** ~30
- **行数:** ~3000+

### 7. 文档
- **路径:** `docs/**`, `README.md`, `AGENTS.md`
- **文件数:** ~30
- **行数:** ~15000+

### 8. Scripts
- **路径:** `scripts/**`
- **文件数:** ~5
- **行数:** ~1000+

---

## 批次计划

| 批次 | 范围 | 文件数 | 行数估算 |
|------|------|--------|----------|
| B01 | src/services, src/tools | 30 | 12000 |
| B02 | src/store | 25 | 10000 |
| B03 | src/types, src/utils | 30 | 8000 |
| B04 | src/components (Part 1) | 25 | 15000 |
| B05 | src/components (Part 2) | 25 | 15000 |
| B06 | src/pages, src/layout | 10 | 5000 |
| B07 | src/hooks, src/core | 15 | 5000 |
| B08 | src/skills/* | 15 | 8000 |
| B09 | src-tauri/src (Part 1) | 20 | 6000 |
| B10 | src-tauri/src (Part 2) | 20 | 6000 |
| B11 | src-tauri/skills | 10 | 5000 |
| B12 | tests, __tests__ | 20 | 8000 |
| B13 | .github/workflows, configs | 15 | 3000 |
| B14 | docs (设计文档) | 15 | 10000 |
| B15 | website/src | 20 | 8000 |

**总计:** ~295+ 文件, ~120000+ 行

---

## 跳过目录

| 目录 | 原因 |
|------|------|
| `node_modules/` | npm依赖 |
| `src-tauri/target/` | Rust编译产物 |
| `src-tauri/gen/` | 生成代码 |
| `src-tauri/icons/` | 二进制图标 |
| `dist/` | 构建输出 |
| `build/` | 构建输出 |
| `coverage/` | 测试报告 |
| `.git/` | 版本控制 |
| `website/node_modules/` | npm依赖 |
| `website/.next/` | Next.js构建 |

---

## 审计标准

每个文件必须检查:
1. ✅ 类型安全 (TypeScript types vs 实际使用)
2. ✅ 状态管理一致性 (Zustand stores)
3. ✅ 错误处理完整性
4. ✅ Async race conditions
5. ✅ 用户输入验证
6. ✅ 安全边界 (path traversal, shell injection)
7. ✅ Streaming/Cancel/Retry逻辑
8. ✅ 测试覆盖
9. ✅ 重复实现/drift检测
10. ✅ TODO/FIXME/HACK风险
11. ✅ 硬编码问题
12. ✅ 资源泄漏 (listener/timer/subscription)
13. ✅ 跨平台兼容性
14. ✅ i18n一致性

---

**更新:** 2026-05-12 初始化完成