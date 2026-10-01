# 抖音账号面板

把 4 个抖音账号变成 **4 个一键直达的入口**。每个账号各自持有一份独立的浏览器登录态，
点一下就进入该账号的创作者中心 —— 不用再"退出登录 → 切换账号 → 重新扫码"。

抖音页面跑在你**真实的 Chrome** 里，不是嵌在应用里，所以它的登录行为和平时手点开浏览器完全一致。

---

## 下载

**[→ 下载最新安装包（Releases）](https://github.com/lsl1931/douyin-account-hub/releases/latest)**

Windows x64，约 106 MB。**目标机器不需要安装 Node.js 或 npm。**

> ⚠️ 安装包没有代码签名，首次运行 Windows 可能弹 SmartScreen 提示，
> 点「更多信息」→「仍要运行」即可。

---

## 快速开始

**方式一：装到别的电脑**（推荐）

下载上面的 `DouyinAccountHub-Setup-<版本>.exe`，拷过去双击安装。装完桌面和开始菜单都会有
「抖音账号面板」，也会出现在 Windows「设置 → 应用」里。

**方式二：从源码装**

| 步骤 | 操作 |
|---|---|
| 1 | 双击 **`install.cmd`**（首次，约 1–2 分钟，会下载 Electron 运行时） |
| 2 | 双击桌面上的 **「抖音账号面板」** 快捷方式，或 **`start.cmd`** |

`install.cmd` 会自动建好桌面快捷方式，并注册到 Windows「设置 → 应用」。

想要自己打安装包：`npm run pack`，产物在 `release\` 下。

## 图标

![应用图标](build/icon-512.png)

`build/icon.ico`（含 16/24/32/48/64/128/256 全部尺寸）。语义是**多账号 + 视频**：
两张错开的白色卡片代表多个账号窗口，前卡片里的播放三角代表视频。

刻意没画音符 —— 那是抖音官方 logo 的母题，撞上去既像山寨也可能有商标问题。
形状全部是几何图形、不依赖任何字体，换台机器或换语言都不会变形。

改设计只需改 `scripts/make-icon.py` 顶部的参数，然后：

```cmd
npm run icon     # 需要 Python + Pillow
```

## 日常使用

1. 点 **「+ 添加账号」**，输入一个你能认出来的名字（比如「主号」「美食号」）
2. 应用会自动打开一个专属的浏览器窗口，落在抖音登录页 —— **扫码登录**
3. 重复 1–2 步，把 4 个账号都加进来

以后每次只要点账号卡片上的 **「打开创作者中心」**，就是那个账号、那个登录态，
不用再扫码，也不会串号。

> 4 个账号的浏览器窗口可以同时开着，互不影响 —— 每个账号用的是各自的浏览器配置目录。

## 卸载

三种方式，效果完全一样：

- 应用内右上角 **「卸载」** 按钮
- Windows **设置 → 应用** 里找到「抖音账号面板」
- 直接运行 `%LOCALAPPDATA%\DouyinAccountHub\uninstall.cmd`

> ⚠️ 卸载是**彻底删除**：程序本体和 4 个账号的登录数据都会消失，重装后需要重新扫码。

## 文件都在哪

```
%LOCALAPPDATA%\DouyinAccountHub\
  runtime\        程序本体（electron + 编译产物）—— 卸载时删除
  data\           你的账号数据                       —— 卸载时删除
    accounts.json   账号列表
    profiles\       每个账号一份浏览器登录态
    logs\app.log    运行日志（出问题时把它发给开发者）
  uninstall.cmd   卸载脚本
```

源码和这个 README 留在本目录，不会被卸载动作碰到。

## 已知限制

- **登录态仍会过期**。这是抖音的服务端行为，任何工具都绕不过；过期后点一下账号重新扫码即可，其他账号不受影响。
- **只做"入口"，不做自动发布**。选视频、填文案、提交发布仍需你在抖音网页上操作。账号 → 独立配置目录 → 浏览器 这套映射已经是自动发布的地基，下一步可以直接接。
- **没有"直达发布页"按钮**。抖音发布页的具体路径我无法联网核实，没验证过的入口不如不做 —— 进去后站内点「发布视频」即可。
- **找不到 Chrome 时会回退到 Edge 并在界面顶部告警**。Edge 与 Chrome 的登录状态互不相通，界面会明确提示，也可以手动指定 chrome.exe。

---

## 开发

```cmd
npm run icon               # 重新生成图标（需要 Python + Pillow）
npm run typecheck          # 两个 tsconfig 的类型检查
npm test                   # 构建 + 31 条单元测试
npm run verify:persistence # 用真实 Chrome 证明 profile 持久化与账号隔离
npm run deploy             # 构建 + 部署到 %LOCALAPPDATA% + 桌面快捷方式 + 注册卸载项
npm run pack               # 打包出可分发的安装包 -> release\
```

端到端自检（真实 Electron 进程跑完整链路，结果写在 `<HUB_ROOT>\selftest-report.json`）：

```cmd
set DYHUB_ROOT=%TEMP%\dyhub-e2e
"%LOCALAPPDATA%\DouyinAccountHub\runtime\electron\electron.exe" "%LOCALAPPDATA%\DouyinAccountHub\runtime\app" --selftest
```

> 自检前必须先关掉正在运行的面板 —— 单实例锁会让新实例直接退出，报告不会生成。

### 打包安装包

`npm run pack` 产出 `release\DouyinAccountHub-Setup-<版本>.exe`（NSIS，约 106 MB，x64）。
目标机器**不需要** Node/npm，双击安装即可；装完桌面和开始菜单都有入口，也会出现在
Windows「设置 → 应用」里。

构建输出刻意**不放在本目录**（`scripts/pack.mjs` 会强制检查这一点），产物先落在
`%LOCALAPPDATA%\DouyinAccountHub-build\`，跑完再拷回来 —— 原因见下方环境约束表里的
"工作区里不能执行可执行文件"。

### 目录结构

```
src/shared/types.ts       主进程与渲染层共享的类型（只放类型，渲染层用 import type）
src/main/paths.ts         HUB_ROOT / runtime / data 的路径解析（纯函数，可单测）
src/main/accountStore.ts  accounts.json 读写 + 原子写 + 损坏备份
src/main/browserLocator.ts 浏览器路径探测
src/main/browserLauncher.ts buildLaunchArgs() 纯函数 + spawnBrowser() 薄适配器
src/main/ipc.ts           IPC 白名单，统一返回 Result
src/main/selftest.ts      端到端自检
src/renderer/             无框架 UI（原生 HTML/CSS/TS）
scripts/make-icon.py      图标生成（参数都在文件顶部）
scripts/deploy.mjs        手动安装：部署 + 卸载脚本 + 快捷方式 + 注册表
scripts/pack.mjs          打包安装包（构建输出强制在工作区外）
scripts/create-shortcut.ps1  创建 .lnk（纯 ASCII，中文名由 Node 当参数传入）
build/installer.nsh       NSIS 定制：卸载时一并删除用户数据
```

设计取舍、数据契约与风险见 `.trellis/tasks/09-30-douyin-multi-account-publisher/design.md`。

---

## 本机环境约束（踩过的坑，别重踩）

| 约束 | 现象 / 原因 | 处理 |
|---|---|---|
| **工作区目录 `dy` 里的可执行文件不能执行** | 不是 Electron 独有：`electron.exe` 一启动即崩（`crashpad: not connected`，exit `-2147483645`）；`makensis.exe` 连输出文件都写不了（`Can't open output file`）。**同一份二进制复制到工作区外就完全正常**，且已排除中文路径 | 运行时部署到 `%LOCALAPPDATA%`；electron-builder 缓存用默认的 `%LOCALAPPDATA%\electron-builder\Cache`；打包输出走 `%LOCALAPPDATA%\DouyinAccountHub-build\` |
| **`.cmd` / `.ps1` / `.nsh` 必须全 ASCII** | cmd 按 ANSI 代码页读 `.cmd`，中文注释（哪怕在 `rem` 里）会变乱码字节，混进 `&`/`>` 就破坏解析。踩了两次：卸载脚本静默失效、start.cmd 把注释当命令执行 | 全 ASCII；`src/test/cmdEncoding.test.ts` 强制守住四类后缀 |
| **npm 缓存必须重定向** | 默认缓存在沙箱外，写入被拒（`EPERM`） | `npm_config_cache=<repo>\.npm-cache` |
| **Electron 二进制缓存变量名是 `electron_config_cache`** | `ELECTRON_CACHE` 无效（`@electron/get` 不读它） | `electron_config_cache=<repo>\.electron-cache` |
| **`ELECTRON_RUN_AS_NODE=1` 由 DSH 终端注入** | 它让 `electron.exe` 退化成纯 Node，`require('electron')` 返回字符串，报错完全指不到病根 | `install.cmd` / `start.cmd` 内置清空 |
| **`execFileSync` 会阻塞事件循环** | 脚本内自带 HTTP 服务时，服务永远无法响应自己同步等待的 Chrome，表现为 `ETIMEDOUT` | 用异步 `execFile` |
| **`chrome.exe` 是 GUI 子系统程序** | PowerShell 的 `&` 不会等它，也拿不到 stdout | 用 Node 的 `execFile`，或 `Start-Process -RedirectStandardOutput` |
| **`--virtual-time-budget` 会让 headless Chrome 不退出** | 等虚拟时间时被后台网络活动拖住 | headless 抓取时不要加这个 flag |
