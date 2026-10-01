# Design：抖音多账号入口面板

> 覆盖范围：**仅 MVP** —— 4 个免登录入口面板。自动发布 / 数据看板 / 作品管理 / 定时发布不在本设计内（见 §7）。

## 1. 一句话架构

Electron 只做**启动器与账号注册表**，**不承载任何抖音页面**。每个账号对应一份独立的 Chrome `--user-data-dir`，抖音永远跑在用户真实的系统 Chrome 里。

```
┌──────────────────────────────────────────────────────┐
│ Electron App「抖音账号面板」                            │
│                                                      │
│  Renderer  面板 UI（原生 HTML/CSS/TS，无框架无打包器）    │
│      │  contextBridge（白名单 IPC）                    │
│  Main Process (Node)                                 │
│      ├─ AccountStore     读写 accounts.json（原子写）   │
│      ├─ BrowserLauncher  解析 Chrome 路径 + detached spawn │
│      └─ Paths            DATA_ROOT 解析                │
└───────────────────┬──────────────────────────────────┘
                    │ detached spawn，进程脱离 Electron 独立存活
                    ▼
      系统 Chrome  ×N（每账号一个 --user-data-dir）
      %LOCALAPPDATA%\DouyinAccountHub\profiles\<accountId>\
```

**为什么不让 Electron 用 BrowserWindow 承载抖音**：Electron 的 UA / 内核特征与真实 Chrome 不同，且登录态会绑在 Electron 的 userData 上，Electron 重装或升级时容易丢。用系统 Chrome 则与用户日常手工登录完全同构，这是"登录态能长期保住"的关键前提。

**为什么 detached**：Chrome 必须能在面板关闭后继续存活，否则用户关掉面板就断了他的浏览会话。

## 2. 数据布局

### 2.1 HUB_ROOT 解析顺序

```ts
function resolveHubRoot(): string {
  if (process.env.DYHUB_ROOT) return path.resolve(process.env.DYHUB_ROOT);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'DouyinAccountHub');
  }
  return app.getPath('userData');
}
const runtimeRoot = () => path.join(resolveHubRoot(), 'runtime');
const dataRoot    = () => path.join(resolveHubRoot(), 'data');
```

`DYHUB_ROOT` 覆盖两个用途：本地测试给出隔离的数据目录；以及 §2.4 的路径约束逃生通道。

### 2.2 目录树

```
HUB_ROOT/
  runtime/               ← 程序本体：electron.exe + 编译产物。卸载时整体删除
    electron/                electron.exe 及其依赖
    app/                     本项目的 dist/（main / preload / renderer）
  data/                  ← 用户数据。卸载时一并删除（用户已确认）
    accounts.json            账号注册表（唯一真相源）
    profiles/
      <accountId>/           Chrome --user-data-dir，一个账号一份
    logs/
      app.log                追加式纯文本日志
```

**为什么 runtime 与 data 必须分开**：卸载必须能"一次删除、不留残渣"，而两者生命周期不同 —— `runtime/` 每次升级整体替换，`data/` 跨版本保留。混在一起会让"升级"与"卸载"都无法干净表达。

`profiles/` 体量可达数百 MB，因此放 `LOCALAPPDATA` 而非 `Roaming`。

### 2.3 accounts.json 契约

```json
{
  "schemaVersion": 1,
  "settings": { "browserPath": null },
  "accounts": [
    {
      "id": "3f2a…-uuid-v4",
      "label": "主号",
      "createdAt": "2026-10-01T07:40:00.000Z",
      "lastOpenedAt": "2026-10-01T08:12:31.000Z"
    }
  ]
}
```

- `id` 是 uuid v4，**同时用作 profile 目录名** —— 单一标识符，避免"改名导致目录与记录脱钩"。
- **不持久化 profileDir 绝对路径**：由 `DATA_ROOT/profiles/<id>` 推导，这样用户整体搬移数据目录后不失效。
- `settings.browserPath`：仅在自动探测失败时由用户手动指定。
- 写入采用**原子写**：先写 `accounts.json.tmp`，再 `fs.renameSync` 覆盖。Windows 上 Node 的 `rename` 走 `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`，可覆盖已存在文件，因此是安全的。
- 读取时若 JSON 损坏：备份为 `accounts.json.corrupt-<ts>`，以空注册表启动并在 UI 上告警 —— 绝不静默清空用户数据。

### 2.4 硬约束：runtime 不得位于 DSH 工作区目录内

**实测结论**：`electron.exe` 若位于 `C:\Users\sqdx66\Desktop\agent工作区\dy`（DSH 工作区根）**之内**，一经启动即崩溃（`exit=-2147483645` / `STATUS_BREAKPOINT`，stderr 仅一行 `crashpad_client_win.cc: not connected`）。移至任何其他位置均正常。

对照实验（每组都是同一份二进制、同一份 app 代码）：

| 位置 | 结果 |
|---|---|
| `C:\edist-test`（纯 ASCII） | ✅ exit=0 |
| `C:\edist-工作区-test`（含中文，工作区外） | ✅ exit=0 → **排除"中文路径"假设** |
| `C:\Users\sqdx66\Desktop\edist-test` | ✅ exit=0 |
| `C:\Users\sqdx66\Desktop\agent工作区\edist-test`（`dy` 的父目录） | ✅ exit=0 |
| `dy\.edist-test`（工作区内） | ❌ 崩溃 |
| **exe 在 `dy` 外 + app 代码在 `dy` 内** | ✅ exit=0 → **只需 exe 不在 `dy` 内** |

`dy` 与父目录的 ACL 差异：`dy` 上额外有 DSH 写入的两条非继承条目 —— `Everyone: Deny DeleteSubdirectoriesAndFiles` 与 `S-1-4-*: Allow Write/Delete`。父目录没有。deny 的存在尚不足以证明因果（`diagnose-windows-sandbox-acl` 也明确警告这一点），但**因果位置已由上面的对照实验锁定到 `dy` 目录本身**。

**设计后果**：`runtime/` 落在 `%LOCALAPPDATA%\DouyinAccountHub\`，**源码可以继续留在 `dy`**（上表最后一行已证明可行）。这同时是更正常的软件安装位置，一举两得。

> 注意：这条约束**只影响 DSH 工作区内的这台机器**，不是 Electron 的普遍行为。但它决定了本项目的运行时布局，必须写进设计。

## 3. IPC 契约

窗口配置：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。渲染层拿不到任何 Node 能力，只能调下面这张白名单表。

```ts
type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

type AccountView = {
  id: string;
  label: string;
  createdAt: string;
  lastOpenedAt: string | null;
  profileDir: string;      // 只读展示，便于用户备份
  profileExists: boolean;  // profile 目录是否还在（被手工删除时提示）
};

type OpenTarget = 'home' | 'upload';

interface Api {
  'accounts:list':   () => Promise<Result<AccountView[]>>;
  'accounts:add':    (p: { label: string }) => Promise<Result<AccountView>>;
  'accounts:rename': (p: { id: string; label: string }) => Promise<Result<AccountView>>;
  'accounts:remove': (p: { id: string; deleteProfile: boolean }) => Promise<Result<null>>;
  'accounts:open':   (p: { id: string; target: OpenTarget }) => Promise<Result<null>>;
  'settings:getBrowser': () => Promise<Result<{ path: string | null; source: string }>>;
  'settings:setBrowser': (p: { path: string | null }) => Promise<Result<null>>;
  'app:revealDataDir': () => Promise<Result<null>>;
}
```

**错误一律用 `Result` 对象返回，不用 reject**：`ipcRenderer.invoke` 的异常跨进程序列化会丢失 `code`，导致 UI 无法区分"Chrome 没找到"和"磁盘写失败"。

## 4. 浏览器启动契约

### 4.1 命令行

```
<chrome.exe>
  --user-data-dir="<DATA_ROOT>\profiles\<accountId>"
  --profile-directory=Default
  --no-first-run
  --no-default-browser-check
  --disable-search-engine-choice-screen
  <url>
```

`spawn(browserPath, args, { detached: true, stdio: 'ignore' }).unref()`

**不需要自建窗口管理**：Chrome 的单例机制以 `--user-data-dir` 为粒度（`SingletonLock`）。同一账号再次点击时，Chrome 会把 URL 转交给已有实例并立即退出，效果正是"聚焦已有窗口"。

### 4.2 Chrome 路径探测顺序

1. `%ProgramFiles%\Google\Chrome\Application\chrome.exe` ✅ 本机实测存在（v154.0.8037.58）
2. `%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe` ✅ 本机实测不存在（仅记录为候选）
3. `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`
4. 注册表 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe`
5. 兜底 Edge `%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe` —— ✅ 本机实测存在。**必须回退到 UI 上明示**，因为 Edge 与 Chrome 的登录态行为不完全一致。
6. 全部失败 → 返回错误码 `BROWSER_NOT_FOUND`，UI 引导用户手动指定路径。

### 4.3 目标 URL

集中在 `src/main/douyin.ts` 一张常量表，便于抖音改版时单点修改：

| target | URL | 状态 |
|---|---|---|
| `home` | `https://creator.douyin.com/` | MVP 默认 |
| `upload` | `https://creator.douyin.com/creator-micro/content/upload` | **待实测确认** |

> ⚠️ `upload` 的路径来自既有认知，本会话联网检索不可用，**未能核实**。实现阶段必须用真实浏览器打开一次确认；确认不了就把该按钮从 MVP 摘掉，只保留 `home`。

## 5. 关键权衡

| 决策 | 选择 | 被否掉的方案 | 理由 |
|---|---|---|---|
| 浏览器归属 | 系统 Chrome + 独立 user-data-dir | Electron BrowserWindow / Playwright Chromium | 真实 Chrome 的风控特征最干净；Playwright 会引入 ~100MB 下载与自动化指纹 |
| 面板形态 | Electron | 本地网页 + 常驻服务 | 用户明确选择"像软件"，双击即用 |
| 渲染层 | 原生 HTML/CSS/TS，无框架 | React + Vite | 4 张卡片不值得一条打包链；TS 只用于类型，`import type` 运行时零开销 |
| 构建 | 纯 `tsc` + 10 行 copy 脚本 | 打包器 | 主进程/preload 走 CJS，渲染层走 ESM，`import type` 保证跨边界类型共享不产生运行时依赖 |
| 账号标识 | 用户自定义备注名 | 自动抓取抖音昵称 | 抓取需要页面自动化，会把脆弱的页面解析拖进 MVP |
| 登录态检测 | **不做**（见 §7） | 读 Cookie 库 / 解析登录页 | 收益不抵脆弱性；手动恢复路径已足够短 |

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Chrome 未安装 / 路径异常 | 面板开不出窗口 | 6 级探测 + 手动指定 + 明确错误码 |
| 抖音登录 cookie 过期 | 需重新扫码 | **平台行为，无法根治**。卡片提供「打开登录页」把恢复路径压到 2 次点击 |
| 用户手工删除 profiles 目录 | 该账号登录态丢失 | 列表用 `profileExists` 标出异常态；删除账号需二次确认；提供「打开数据目录」便于备份 |
| Chrome 版本升级改变 flag 语义 | 启动失败 | flag 只用长期稳定项；启动失败时记录完整命令行到 `logs/app.log` |
| 沙箱内写 `%LOCALAPPDATA%` 被拒 | 开发期跑不起来 | `DYHUB_DATA_DIR` 覆盖（§2.1） |
| Electron 二进制下载走境外源失败 | 装不上 | 已实测：`registry.npmmirror.com` + `electron_config_cache` 重定向可用 |
| `ELECTRON_RUN_AS_NODE=1` 被 DSH shell 注入 | `electron.exe` 静默退化成纯 Node，`require('electron')` 返回字符串，报错完全指不到病根 | `启动面板.cmd` **内置清空该变量**；此坑写入 §9 |
| DSH 沙箱禁命名管道 → Chromium 起不来 | Chrome / Electron 在沙箱 shell 中均以 `crashpad: OpenProcess 拒绝访问` 自我终止 | **仅影响开发期我方验证**，用户双击运行无此限制。见 §9 |

## 7. 验证策略（因沙箱限制而必须分层）

已实测：**DSH 沙箱 shell 中 Chrome 与 Electron 都无法启动**（Chromium crashpad 被拒绝访问父进程 → `crash server failed to launch, self-terminating`）。因此验证分三层，把"能在沙箱内证明的"与"必须真跑浏览器的"彻底切开：

| 层 | 内容 | 在哪跑 | 依赖 |
|---|---|---|---|
| L1 纯逻辑 | 账号注册表 CRUD、原子写、损坏 JSON 恢复、DATA_ROOT 解析、浏览器路径探测、`argv` 构造、URL 常量 | 沙箱内 `node --test` | 零 Chromium |
| L2 静态 | `tsc --noEmit` 类型检查、IPC 白名单闭合性核对 | 沙箱内 | — |
| L3 端到端 | 面板启动 → 点账号 → 浏览器以独立 profile 打开 → 关闭面板后浏览器存活 → 重开面板登录态仍在 | **提权运行**（用户已授权，届时弹审批） | 真实 Chromium |

**这个分层是一等约束，不是事后补丁**：`browserLauncher` 被刻意拆成「纯函数 `buildLaunchArgs()`」+「薄 `spawn` 适配器」，就是为了让 L1 覆盖除 spawn 本身以外的全部启动逻辑。

> L3 是本任务唯一无法由沙箱内自动化证明的环节，因此**最后一个 gate 必须是真实的一轮 L3**，不允许用 L1/L2 全绿替代。

## 8. 明确不做（Deferred）

- **登录态自动检测**：需要解析抖音页面（脆弱）或解析 Chrome 的加密 Cookie 库（需 SQLite + DPAPI）。替代方案已覆盖 90% 价值 —— 显示「上次打开时间」+「打开登录页」按钮。
- **自动发布**（下一任务，本次架构已为其预留：账号 → profile 目录 → 浏览器 的映射是自动化发布的地基）
- **一稿多发 / 每账号独立文案**（同上）
- **数据看板 / 作品管理 / 定时发布**
- **安装包（installer）**：MVP 交付 `启动面板.cmd` + `npm start`。打包为便携目录是 P1。

## 9. 可回滚性

全部为**新增**文件（`package.json`、`tsconfig*.json`、`src/`、`scripts/`、`.gitignore`），不改动任何既有文件。回滚 = 删除新增路径。用户数据（`profiles/`、`accounts.json`）完全独立于代码目录，删代码不会影响已登录的 Chrome profile。
