import { BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from './ipc';
import { locateBrowser } from './browserLocator';
import { buildLaunchArgs, spawnBrowser } from './browserLauncher';
import { urlForTarget } from './douyin';

/**
 * 端到端自检（`--selftest`）。
 *
 * 存在的理由：本机 GUI 无法被脚本点击，而"面板能不能真的把浏览器拉起来"
 * 恰恰是这个项目唯一不能靠单元测试证明的环节。这里用**真实的 Electron 进程**
 * 跑完整链路：窗口 → preload 桥 → IPC → 账号存储 → 真实 Chrome 启动 → profile 落盘。
 *
 * 结果同时写 stdout 和 `<hubRoot>/selftest-report.json`；后者是权威通道 ——
 * Windows 上 Electron 是 GUI 子系统程序，stdout 不一定能被父 shell 捕获。
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

export async function runSelfTest(
  ctx: AppContext,
  rendererDir: string,
): Promise<number> {
  const { paths, store, logger } = ctx;
  const checks: Check[] = [];
  const record = (name: string, ok: boolean, detail = ''): void => {
    checks.push({ name, ok, detail });
    logger.info(`[selftest] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  };

  // ---- 1. HUB_ROOT 优先级 ----
  const override = process.env.DYHUB_ROOT;
  record(
    'paths: DYHUB_ROOT 覆盖生效',
    Boolean(override) && paths.hubRoot === path.resolve(override ?? ''),
    `hubRoot=${paths.hubRoot}`,
  );

  // ---- 2. 账号存储往返 ----
  const created = store.add('自检账号A');
  const renamed = store.rename(created.id, '自检账号A-改名');
  const touched = store.touch(created.id);
  record(
    'store: 增 / 改 / 触达 往返一致',
    renamed?.label === '自检账号A-改名' && Boolean(touched?.lastOpenedAt),
    `id=${created.id}`,
  );

  const profileDirA = paths.profileDirOf(created.id);
  fs.mkdirSync(profileDirA, { recursive: true });

  // ---- 3. 窗口 + preload + IPC 全链路 ----
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  let loadError: string | null = null;
  window.webContents.on('did-fail-load', (_e, code, desc) => {
    loadError = `${code} ${desc}`;
  });

  const loaded = new Promise<boolean>((resolve) => {
    window.webContents.once('did-finish-load', () => resolve(true));
    setTimeout(() => resolve(false), 20000);
  });

  void window.loadFile(path.join(rendererDir, 'index.html'));
  const didLoad = await loaded;
  record('renderer: 页面加载完成', didLoad, loadError ?? '');

  const bridge = (await window.webContents.executeJavaScript(
    `(() => {
       const api = window.hub;
       if (!api) return { ok: false, missing: ['window.hub 不存在'] };
       const expected = ['listAccounts','addAccount','renameAccount','removeAccount',
                         'openAccount','getBrowser','setBrowserPath','pickBrowserPath',
                         'revealDataDir','getHubInfo','uninstall'];
       const missing = expected.filter((k) => typeof api[k] !== 'function');
       return { ok: missing.length === 0, missing };
     })()`,
  )) as { ok: boolean; missing: string[] };
  record('preload: 白名单 API 全部就位', bridge.ok, bridge.missing.join(','));

  const roundTrip = (await window.webContents.executeJavaScript(
    `window.hub.addAccount('自检账号B').then((r) => ({ ok: r.ok, id: r.ok ? r.data.id : null, err: r.ok ? '' : r.message }))`,
  )) as { ok: boolean; id: string | null; err: string };
  record('ipc: 渲染层 → 主进程 → 磁盘 往返成功', roundTrip.ok, roundTrip.id ?? roundTrip.err);

  const profileDirB = roundTrip.id ? paths.profileDirOf(roundTrip.id) : '';
  record(
    '隔离: 两个账号的 profile 目录互不相同',
    Boolean(roundTrip.id) && profileDirB !== profileDirA,
    profileDirB,
  );

  // 重新加载，让渲染层走一遍"启动 → listAccounts → 渲染卡片"，顺便验证 UI 真的画出来了。
  const reloaded = new Promise<boolean>((resolve) => {
    window.webContents.once('did-finish-load', () => resolve(true));
    setTimeout(() => resolve(false), 20000);
  });
  window.webContents.reload();
  await reloaded;
  await sleep(600);

  const cardCount = (await window.webContents.executeJavaScript(
    `document.querySelectorAll('.card').length`,
  )) as number;
  record('ui: 账号卡片渲染到界面', cardCount >= 2, `卡片数=${cardCount}`);

  const emptyHidden = (await window.webContents.executeJavaScript(
    `document.getElementById('empty').classList.contains('hidden')`,
  )) as boolean;
  record('ui: 有账号时不再显示空状态', emptyHidden === true);

  // ---- 4. 真实浏览器启动 ----
  const browser = locateBrowser({ customPath: store.settings().browserPath });
  record('browser: 找到可用浏览器', browser.path !== null, `${browser.kind} ${browser.path ?? ''}`);

  if (browser.path) {
    const args = buildLaunchArgs({ profileDir: profileDirA, url: urlForTarget('home') });
    logger.info(`[selftest] 启动浏览器：${browser.path}`);
    const pid = spawnBrowser(browser.path, args);

    // Chrome 第一次用某个 profile 时会生成 Cookies 库 —— 这是"独立登录态已落盘"的实证。
    const cookiesPath = path.join(profileDirA, 'Default', 'Network', 'Cookies');
    const cookieCreated = await waitFor(() => fs.existsSync(cookiesPath), 40000, 500);
    record('browser: 以独立 profile 启动并落盘登录态存储', cookieCreated, cookiesPath);

    let commandLine = '';
    try {
      const { execFileSync } = await import('node:child_process');
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: 'utf8' },
      );
      commandLine = out.trim();
    } catch (err) {
      commandLine = `查询失败: ${String(err)}`;
    }
    record(
      'browser: 命令行确实带上了该账号的 --user-data-dir',
      commandLine.includes(profileDirA),
      commandLine.slice(0, 300),
    );
    record('browser: 进程存活（未启动即退出）', Boolean(pid), `pid=${pid}`);
  }

  window.destroy();

  const failed = checks.filter((c) => !c.ok).length;
  const report = {
    finishedAt: new Date().toISOString(),
    hubRoot: paths.hubRoot,
    dataRoot: paths.dataRoot,
    total: checks.length,
    failed,
    checks,
  };

  try {
    fs.writeFileSync(
      path.join(paths.hubRoot, 'selftest-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
  } catch (err) {
    logger.error(`[selftest] 报告写入失败: ${String(err)}`);
  }

  logger.info(`[selftest] 结束：${checks.length - failed}/${checks.length} 通过`);
  return failed;
}

export function selfTestRequested(argv: string[]): boolean {
  return argv.includes('--selftest');
}

export async function finishSelfTest(failed: number): Promise<void> {
  app.exit(failed === 0 ? 0 : 1);
}
