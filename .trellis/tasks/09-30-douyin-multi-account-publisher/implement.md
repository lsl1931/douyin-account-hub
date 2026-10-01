# Implement：抖音多账号入口面板

> 依赖 `prd.md`（需求与验收）与 `design.md`（架构与契约）。本文件只讲**执行顺序、验证命令、回滚点**。

## 0. 环境事实（已实测，不要再踩一遍）

| 项 | 实测值 |
|---|---|
| npm registry | `https://registry.npmmirror.com` |
| Electron | **44.5.1**，二进制已实测下载成功并可解压（内置 Node 24.21.0） |
| 系统 Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe`，**v154.0.8037.58** ✅ |
| 系统 Edge | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` ✅ |
| Node / npm / pnpm | v24.20.0 / 11.x / 11.7.0 |

**三条硬约束（不遵守就会浪费大量时间）**：

1. **npm 缓存必须重定向**。默认 `%LOCALAPPDATA%\npm-cache` 在沙箱外，写入被拒（`EPERM`）。
   → `npm_config_cache=<repo>\.npm-cache`
2. **Electron 二进制缓存必须重定向**，且变量名是 **`electron_config_cache`**（`ELECTRON_CACHE` 无效——实测过）。
   还需 `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`。
3. **`ELECTRON_RUN_AS_NODE=1` 由 DSH shell 注入**。它会让 `electron.exe` 退化成纯 Node：`require('electron')` 返回一个路径字符串，`app` 为 `undefined`，报错是 `TypeError: Cannot read properties of undefined (reading 'getPath')`——完全指不到病根。所有启动脚本必须先清空它。

## 1. 步骤序列

### S0 清场与骨架

1. 删除探针产物：`.probe-electron/`、`.probe-chrome/`、`.probe-appdata/`、`.probe-local/`、`.probe-chrome-out.txt`、`.probe-chrome-err.txt`。
   **保留** `.npm-cache/` 与 `.electron-cache/`（省掉一次 ~100MB 重下）。
2. 建 `package.json`（devDeps 仅 `electron` / `typescript` / `@types/node`；**运行时依赖 0**）。
3. 建 `.gitignore`，必须覆盖：`node_modules/`、`dist/`、`.npm-cache/`、`.electron-cache/`、`.e2e-data/`、`.dev-data/`。

> 回滚点 R0：`git` 尚未初始化，删除新增文件即可完全回滚。

### S1 纯逻辑层（顺序即依赖顺序）

| # | 文件 | 内容 | 为什么放这一层 |
|---|---|---|---|
| S1.1 | `src/shared/types.ts` | `Result<T>` / `AccountView` / `OpenTarget` / 错误码枚举 | 主进程与渲染层共享，仅类型 |
| S1.2 | `src/main/paths.ts` | `resolveDataRoot()`、`profileDirOf(id)`、`accountsFilePath()` | 纯函数，L1 可测 |
| S1.3 | `src/main/accountStore.ts` | 读/写 `accounts.json`；原子写；损坏文件备份恢复 | 全部是文件 IO 逻辑，L1 可测 |
| S1.4 | `src/main/browserLocator.ts` | 6 级浏览器路径探测 | 纯文件系统探测，L1 可测 |
| S1.5 | `src/main/douyin.ts` | URL 常量表 | 纯数据 |
| S1.6 | `src/main/browserLauncher.ts` | **`buildLaunchArgs()` 纯函数** + 薄 `spawnBrowser()` | 刻意拆分，让 L1 覆盖除 spawn 外的全部逻辑 |
| S1.7 | `src/main/logger.ts` | 追加式文本日志到 `DATA_ROOT/logs/app.log` | L3 排障的唯一手段 |

### S2 L1 单元测试（零依赖，`node:test`）

| 文件 | 必测用例 |
|---|---|
| `test/paths.test.ts` | `DYHUB_DATA_DIR` 优先；Windows 走 `LOCALAPPDATA`；两者都缺时兜底 |
| `test/accountStore.test.ts` | 首次读取返回空表不报错；增删改往返一致；**原子写后原文件不残留 tmp**；**损坏 JSON 被备份为 `.corrupt-*` 且不丢数据**；并发写不产生半截文件 |
| `test/browserLocator.test.ts` | 候选顺序正确；候选都不存在时返回 `null` 而非抛异常；命中 Edge 时标记 `isFallback: true` |
| `test/browserLauncher.test.ts` | `argv` 含 `--user-data-dir` 且指向 `DATA_ROOT/profiles/<id>`；**`--profile-directory=Default` 不会被吞**；URL 出现在最后；账号 id 含空格/中文时参数被正确引用 |

> **门禁 G1**：`npm test` 全绿。这是唯一能在沙箱内自动化的行为验证，必须真跑、真过。

### S3 Electron 外壳

1. `src/main/ipc.ts` —— 注册 `design.md §3` 白名单里的全部 channel，统一包成 `Result`。
2. `src/main/index.ts` —— `app.whenReady()` → 建窗（`contextIsolation:true` / `nodeIntegration:false` / `sandbox:true`）→ 加载 `dist/renderer/index.html`。
3. `src/preload.ts` —— `contextBridge.exposeInMainWorld('api', …)`，逐个方法转发，**不暴露裸 `ipcRenderer`**。
4. `src/renderer/{index.html,styles.css,renderer.ts}` —— 卡片网格 + 添加/重命名/删除/打开；顶部异常横幅（浏览器兜底或未找到）；`import type` 引共享类型（运行时零依赖）。
5. 添加账号的默认行为：**创建后立刻打开该账号的浏览器并落在登录页**，用户直接扫码。

> **门禁 G2**：`npm run typecheck` 全绿；人工核对 `preload` 暴露面与 `ipc.ts` 注册面**一一对应**，不多不少。

### S4 构建与启动脚本

1. `tsconfig.json`（主进程 + preload + shared + test，CJS，`rootDir: src`，`outDir: dist`，**exclude `src/renderer/**`**）
2. `tsconfig.renderer.json`（renderer + shared，ESM，`lib: dom`，同样 `rootDir: src` / `outDir: dist`）
   —— 两个配置共用 `rootDir: src`，是为了让 renderer 能 `import type` 到 `src/shared` 而不触发 "not under rootDir"。
3. `scripts/copy-assets.mjs` —— 把 `index.html` / `styles.css` 拷到 `dist/renderer/`。
4. `install.cmd` / `start.cmd` —— **仅 ASCII 文件名**（`.cmd` 在中文 Windows 按 ANSI 解码，中文文件名/内容易乱码）。
   - `install.cmd`：设置上述三个环境变量 → `npm install` → `npm run build`
   - `start.cmd`：`set "ELECTRON_RUN_AS_NODE="` → 检查 `dist/main/index.js` 存在 → 启动 electron
   - `start.cmd` **绝不设置** `DYHUB_DATA_DIR`（那是验证用的，真实用户数据必须落在 `%LOCALAPPDATA%`）

### S5 确认抖音 URL（**可能触发范围收缩**）

用真实浏览器打开 `https://creator.douyin.com/`，确认：
- 首页可达 ✅/❌
- `creator-micro/content/upload` 是否为发布页 ✅/❌

**确认不了就把「去发布」按钮从 MVP 摘掉，只保留「打开创作者中心」** —— 宁可少一个按钮，不留一个必然 404 的入口。这个决定记进 `design.md §4.3`。

### S6 L3 端到端（**需提权**）

用户已授权：用一次 `danger-full-access` 重跑，DSH 会弹审批。

用例（每条都要看到真实结果，不接受"应该没问题"）：

| # | 操作 | 期望 |
|---|---|---|
| L3-1 | 用 `DYHUB_DATA_DIR=<repo>/.e2e-data` 启动面板 | 窗口出现，无账号，空状态提示正确 |
| L3-2 | 添加账号「测试A」 | `accounts.json` 生成；`profiles/<id>/` 生成；Chrome 以独立 profile 打开且落在抖音页 |
| L3-3 | 再添加账号「测试B」 | 两个 profile 目录**互不相同**；两个 Chrome 窗口**同时存在互不干扰** |
| L3-4 | 关闭面板，观察 Chrome | Chrome **继续存活**（验证 detached 生效） |
| L3-5 | 重开面板 | 账号列表从磁盘读回，「上次打开时间」已更新 |
| L3-6 | 在 L3-2 的 Chrome 里完成扫码登录 → 关闭该窗口 → 重开面板点同一账号 | **免扫码直接进入**（核心验收点） |
| L3-7 | 再点同一账号（窗口已开着） | 不新开窗口，聚焦/复用已有实例 |
| L3-8 | 删除账号（彻底删除） | 记录消失且 `profiles/<id>/` 被删除 |
| L3-9 | 手工把 `accounts.json` 改成非法 JSON 再启动 | 不崩溃；生成 `.corrupt-*` 备份；UI 告警 |

> **门禁 G3（最终）**：L3-6 必须由**我**在提权下亲自跑到，不能委托用户、不能用 L1/L2 替代。
> L3-6 需要真实扫码，若用户当时不在场，则降级为「我用一个真实抖音账号完成扫码」不可行时 → 明确记录为**未验证项**并交用户补验，不许含糊带过。

## 2. 验证命令速查

```cmd
:: 安装（自动带齐三个必需环境变量）
install.cmd

:: 沙箱内可跑
npm run typecheck
npm test

:: 启动（沙箱内会因 crashpad 失败，属预期）
:: 提权后：
set DYHUB_DATA_DIR=%CD%\.e2e-data
set ELECTRON_RUN_AS_NODE=
node_modules\.bin\electron.cmd .
```

## 3. 风险点与回滚

| 风险 | 触发点 | 应对 | 回滚 |
|---|---|---|---|
| Electron 装不上 | S0 | 已实测镜像可用；失败则换 `ELECTRON_MIRROR` 或改用手工解压 zip 到 `dist/` | 删 `node_modules/` 重来 |
| 两个 tsconfig 输出互相覆盖 | S4 | `main` 配置 exclude `renderer/**`；build 后核对 `dist/` 结构 | 删 `dist/` 重建 |
| `start.cmd` 在中文字符下乱码 | S4 | 文件名与内容全 ASCII | — |
| 抖音 `upload` URL 猜错 | S5 | 确认不了就摘掉按钮（范围收缩，不降验收） | 改 `douyin.ts` 一行 |
| 沙箱内无法验证 Chromium | S6 | 已授权提权；**L3 是本任务唯一不可替代的门禁** | — |
| 提权审批被拒 | S6 | 立即停止并如实报告；不假装验证过 | 转由用户执行 L3 |

## 4. 交付物

```
package.json  tsconfig.json  tsconfig.renderer.json  .gitignore  README.md
install.cmd   start.cmd
scripts/copy-assets.mjs
src/…（shared / main / preload / renderer）
test/…（4 个测试文件）
```
