# Journal - sqdx66 (Part 1)

> AI development session journal
> Started: 2026-09-30

---



## Session 1: 抖音账号面板：从零到可运行
<!-- trellis-session: v=2 fp=8366901be53993c0 -->

**Date**: 2026-10-01
**Task**: 抖音账号面板：从零到可运行

### Summary

构建 Electron 桌面应用：4 个抖音账号各自独立持久登录态，点一下直达，免重复扫码。含卸载、数据损坏恢复、三层验证。

### Main Changes

- Electron 主进程分层：paths/accountStore/browserLocator/browserLauncher 全部不依赖 electron，可在沙箱内单测
- 账号 → 独立 Chrome --user-data-dir 映射；runtime 与 data 严格分离以支持干净卸载
- accounts.json 原子写 + 损坏时备份为 .corrupt-* 而非清空
- IPC 统一返回 Result；preload 只暴露白名单方法，不暴露 ipcRenderer
- 部署到 %LOCALAPPDATA%\\DouyinAccountHub（因工作区目录内 electron.exe 无法启动）
- 卸载：应用内入口 + HKCU 注册表项 + uninstall.cmd（委托分离 PowerShell 进程删除自身所在目录）

### Git Commits

(No commits - planning session)

### Testing

- [OK] npm test：31/31 通过（含 .cmd 必须全 ASCII 的门禁）
- [OK] npm run verify:persistence：真实 Chrome 双进程证明 cookie 持久化 + 跨 profile 隔离
- [OK] electron --selftest：12/12，覆盖窗口/preload/IPC/UI 渲染/真实 Chrome 启动/profile 落盘
- [OK] AC4 浏览器在面板退出后存活、AC7 重复点击复用实例、AC9 损坏 JSON 恢复、卸载彻底清除

### Status

[OK] **Completed**

### Next Steps

- 由用户在真实抖音账号上完成扫码 → 关窗口 → 重开面板 → 免扫码进入的最终确认（AC6）
- 下一阶段：自动发布（选视频 → 每账号独立文案 → 提交），现有账号/profile 映射即为其地基
- 待联网确认抖音发布页 URL 后，再决定是否加入「直达发布页」按钮


## Session 2: 图标、桌面快捷方式、可分发的安装包
<!-- trellis-session: v=2 fp=4ed0301e74a4a8d5 -->

**Date**: 2026-10-01
**Task**: 图标、桌面快捷方式、可分发的安装包

### Summary

为抖音账号面板设计应用图标、生成桌面快捷方式、并用 electron-builder 打出可在其他设备上安装的 NSIS 安装包。过程中定位到一个影响面很广的环境约束。

### Main Changes

- 图标：scripts/make-icon.py 用 Pillow 纯几何生成（多账号卡片 + 播放三角），16/24/32/48/64/128/256 全尺寸 ICO，不依赖字体
- 图标接入：渲染进 dist/icon.ico（开发态与安装版相对位置一致），窗口 icon、快捷方式、NSIS 安装包、exe 资源全部使用同一份
- 桌面快捷方式：scripts/create-shortcut.ps1 纯 ASCII + 中文名由 Node 传参，已并入 deploy.mjs，install.cmd 自动创建
- 安装包：electron-builder NSIS（x64，106 MB，非一键式、可选安装目录、自动建桌面与开始菜单项）
- build/installer.nsh：NSIS 卸载时一并删除 %LOCALAPPDATA%\DouyinAccountHub\data；用非递归 RMDir 收尾，避免误删共存的手动安装 runtime
- 应用模式感知：app.isPackaged 时 runtimeRoot 指向安装目录；卸载改走 NSIS 卸载程序并自行清理数据目录
- scripts/pack.mjs：强制构建输出在工作区之外，跑完再把安装包拷回 release/
- 环境约束升级为通用规则：工作区目录里的可执行文件不能执行 —— electron.exe 崩溃、makensis.exe 连输出文件都写不了，同一份二进制搬到工作区外即正常
- cmdEncoding 测试从 .cmd 扩展到 .ps1/.nsh，并递归扫描（跳过 node_modules/dist/release）

### Git Commits

(No commits - planning session)

### Testing

- [OK] npm test：31/31（含四类脚本文件的 ASCII 门禁）
- [OK] typecheck 双配置通过；electron --selftest 12/12；profile 持久化与隔离验证通过
- [OK] 快捷方式：explorer 打开 .lnk -> 面板进程 4 个、窗口标题「抖音账号面板」
- [OK] 安装包端到端：/S 静默安装 -> 程序/资源/卸载器就位、桌面与开始菜单快捷方式创建、注册表项出现在「设置→应用」
- [OK] exe 内嵌图标抽样：左上透明、粉红渐变、中心抖音红 (254,34,77)；ICO 各尺寸白/红占比一致（~15%/~73%），缩放不糊
- [OK] 安装版可运行（4 进程 + 正确窗口标题）；静默卸载后安装目录、开始菜单项、用户数据目录全部清除

### Status

[OK] **Completed**

### Next Steps

- 由用户在真实抖音账号上完成扫码 -> 关窗口 -> 重开面板 -> 免扫码进入（AC6）
- 下一阶段：自动发布（选视频 -> 每账号独立文案 -> 提交）
- 可选：给安装包做代码签名，消除其他设备首次运行时的 SmartScreen 提示
