#!/usr/bin/env node
/**
 * 部署脚本：把运行时安装到 HUB_ROOT，并注册 Windows 卸载项。
 *
 * 为什么用 Node 而不是继续堆批处理：这里要做路径解析、条件解压、目录同步、
 * 注册表写入和结果校验，写成 .cmd 会变成一坨没人敢改的东西。
 * .cmd 只保留"设置环境变量后转发"这一件事。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

const UNINSTALL_REG_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DouyinAccountHub';

/** 桌面快捷方式与「设置 → 应用」里显示的名字 */
const SHORTCUT_NAME = '抖音账号面板';
const SHORTCUT_DESCRIPTION = '抖音多账号入口面板 —— 4 个账号各自保持登录，点一下直达';

function log(message) {
  console.log(`[deploy] ${message}`);
}

function step(name, fn) {
  log(`${name} ...`);
  fn();
}

function resolveHubRoot() {
  const override = process.env.DYHUB_ROOT;
  if (typeof override === 'string' && override.trim() !== '') return path.resolve(override);
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData !== 'string' || localAppData.trim() === '') {
    throw new Error('LOCALAPPDATA 不存在，无法确定安装位置（可显式设置 DYHUB_ROOT）');
  }
  return path.join(localAppData, 'DouyinAccountHub');
}

const hubRoot = resolveHubRoot();
const runtimeRoot = path.join(hubRoot, 'runtime');
const electronDir = path.join(runtimeRoot, 'electron');
const appDir = path.join(runtimeRoot, 'app');
const dataRoot = path.join(hubRoot, 'data');
const electronExe = path.join(electronDir, 'electron.exe');

function dirSizeBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSizeBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

/**
 * 卸载脚本。全 ASCII —— .cmd 在中文 Windows 上按 ANSI 解码，非 ASCII 内容会乱码
 * （这个坑真踩过一次：中文注释被写成乱码字节，脚本静默失效）。
 *
 * 设计要点：真正的清理交给一个**分离的 PowerShell 进程**。
 * 脚本本体位于 HUB 目录内，而 HUB 本身要被删掉 —— cmd 删不掉正在执行的自己；
 * 分离进程能在脚本退出后从容删除。用 PowerShell 而不是继续在 cmd 里做引号嵌套，
 * 是因为路径要用单引号包住才安全，而 cmd 的 `""..""` 嵌套极其难调。
 */
const UNINSTALL_CMD = `@echo off
setlocal EnableExtensions
set "HUB=%~dp0"
if "%HUB:~-1%"=="\\" set "HUB=%HUB:~0,-1%"
set "WAITPID=%~1"

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$p='%WAITPID%'; if($p -ne ''){ while(Get-Process -Id $p -ErrorAction SilentlyContinue){ Start-Sleep -Milliseconds 500 } }; Start-Sleep -Seconds 2; Remove-Item -LiteralPath '%HUB%' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DouyinAccountHub' -Recurse -Force -ErrorAction SilentlyContinue"

exit /b 0
`;

function ensureElectron() {
  const electronPkgDir = path.join(projectRoot, 'node_modules', 'electron');
  if (!fs.existsSync(electronPkgDir)) {
    throw new Error('缺少 node_modules/electron，请先运行 npm install');
  }

  const electronPkg = JSON.parse(
    fs.readFileSync(path.join(electronPkgDir, 'package.json'), 'utf8'),
  );

  const versionFile = path.join(electronDir, 'version');
  const installed = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, 'utf8').replace(/^v/, '').trim()
    : null;

  if (fs.existsSync(electronExe) && installed === electronPkg.version) {
    log(`electron ${installed} 已就绪，跳过`);
    return;
  }

  const sourceDist = path.join(electronPkgDir, 'dist');
  if (!fs.existsSync(path.join(sourceDist, 'electron.exe'))) {
    log('electron 二进制缺失，先执行官方安装脚本下载解压');
    execFileSync(process.execPath, ['install.js'], {
      cwd: electronPkgDir,
      stdio: 'inherit',
      env: process.env,
    });
  }

  if (!fs.existsSync(path.join(sourceDist, 'electron.exe'))) {
    throw new Error(`electron 安装脚本执行后仍找不到 ${sourceDist}\\electron.exe`);
  }

  // 关键一步：把二进制搬出项目目录。
  // 实测 electron.exe 若位于 DSH 工作区目录内，一启动就崩（crashpad not connected）。
  log(`同步 electron 运行时 -> ${electronDir}`);
  fs.rmSync(electronDir, { recursive: true, force: true });
  fs.mkdirSync(electronDir, { recursive: true });
  fs.cpSync(sourceDist, electronDir, { recursive: true });

  if (!fs.existsSync(electronExe)) {
    throw new Error(`同步后仍找不到 ${electronExe}`);
  }
}

function runBuild() {
  const tsc = path.join(projectRoot, 'node_modules', '.bin', 'tsc.cmd');
  const tscJs = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  for (const project of ['tsconfig.json', 'tsconfig.renderer.json']) {
    log(`编译 ${project}`);
    execFileSync(process.execPath, [tscJs, '-p', project], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    void tsc;
  }

  log('拷贝渲染层静态资源');
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'copy-assets.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}

function syncApp() {
  const sourceDist = path.join(projectRoot, 'dist');
  if (!fs.existsSync(path.join(sourceDist, 'main', 'index.js'))) {
    throw new Error('dist/main/index.js 不存在，构建没有成功');
  }

  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  fs.cpSync(sourceDist, path.join(appDir, 'dist'), { recursive: true });

  // 只写运行时需要的字段：不带 devDependencies 和 scripts，避免误触发 npm 行为。
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        private: true,
        description: pkg.description,
        main: 'dist/main/index.js',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const required = [
    path.join(appDir, 'package.json'),
    path.join(appDir, 'dist', 'main', 'index.js'),
    path.join(appDir, 'dist', 'preload.js'),
    path.join(appDir, 'dist', 'renderer', 'index.html'),
    path.join(appDir, 'dist', 'renderer', 'renderer.js'),
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`部署产物缺失：${file}`);
  }
}

function writeUninstaller() {
  // 卸载脚本用单引号把路径嵌进 PowerShell 命令里，路径含单引号会破坏它。
  // 正常安装位置不可能出现单引号，所以直接拒绝而不是写一个脆弱的转义。
  if (hubRoot.includes("'")) {
    throw new Error(`安装路径不能包含单引号：${hubRoot}`);
  }

  const target = path.join(hubRoot, 'uninstall.cmd');
  const content = UNINSTALL_CMD.replace(/\n/g, '\r\n');

  // 防呆：非 ASCII 字节在中文 Windows 的 cmd 里会被按 ANSI 解错，
  // 上一次就是这么把中文注释写成乱码、进而让脚本静默失效的。
  for (let i = 0; i < content.length; i += 1) {
    const code = content.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error(
        `uninstall.cmd 含非 ASCII 字符（第 ${i} 个字符 U+${code.toString(16).toUpperCase()}）。` +
          '.cmd 必须全 ASCII —— 包括注释。',
      );
    }
  }

  fs.writeFileSync(target, content, 'ascii');
  log(`写入卸载脚本 ${target}（${content.length} 字符，全 ASCII 校验通过）`);
}

function writeRegistry() {
  const uninstaller = path.join(hubRoot, 'uninstall.cmd');
  const sizeKb = Math.max(1, Math.round(dirSizeBytes(runtimeRoot) / 1024));

  const values = [
    ['DisplayName', 'REG_SZ', SHORTCUT_NAME],
    ['DisplayVersion', 'REG_SZ', pkg.version],
    ['InstallLocation', 'REG_SZ', hubRoot],
    ['UninstallString', 'REG_SZ', `"${uninstaller}"`],
    ['QuietUninstallString', 'REG_SZ', `"${uninstaller}"`],
    ['DisplayIcon', 'REG_SZ', electronExe],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
    ['EstimatedSize', 'REG_DWORD', String(sizeKb)],
  ];

  for (const [name, type, value] of values) {
    execFileSync('reg', ['add', UNINSTALL_REG_KEY, '/v', name, '/t', type, '/d', value, '/f'], {
      stdio: 'pipe',
    });
  }
  log(`已注册到 Windows「设置 → 应用」：${UNINSTALL_REG_KEY}`);
}

/**
 * 桌面快捷方式。
 *
 * 逻辑放在 .ps1 而不是 Node 里，是因为创建 .lnk 只能靠 WScript.Shell COM；
 * 而 .ps1 保持纯 ASCII、把中文名字当参数传进去，正好绕开 PowerShell 5.1
 * 按 ANSI 解码脚本文件的老毛病。
 */
function createShortcut() {
  const script = path.join(projectRoot, 'scripts', 'create-shortcut.ps1');
  if (!fs.existsSync(script)) throw new Error(`缺少快捷方式脚本：${script}`);

  const out = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-HubRoot',
      hubRoot,
      '-ShortcutName',
      SHORTCUT_NAME,
      '-Description',
      SHORTCUT_DESCRIPTION,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  log(out.trim());
}

function main() {
  log(`安装位置 HUB_ROOT=${hubRoot}`);

  step('准备目录', () => {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.mkdirSync(dataRoot, { recursive: true });
  });

  step('准备 electron 运行时', ensureElectron);
  step('构建', runBuild);
  step('同步应用', syncApp);
  step('写卸载脚本', writeUninstaller);
  step('创建桌面快捷方式', createShortcut);
  step('注册卸载项', writeRegistry);

  log('完成。');
  log(`  启动：${path.join(electronExe)}`);
  log(`  数据：${dataRoot}`);
}

try {
  main();
} catch (err) {
  console.error(`[deploy] 失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
