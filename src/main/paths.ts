/**
 * 目录解析。**故意不 import electron** —— 保持纯函数才能在沙箱内做单元测试。
 * 需要 electron 的默认值时由调用方通过 `fallback` 注入。
 */
import os from 'node:os';
import path from 'node:path';

export interface HubPaths {
  hubRoot: string;
  runtimeRoot: string;
  dataRoot: string;
  accountsFile: string;
  profilesRoot: string;
  logsRoot: string;
  logFile: string;
  /** 某账号的 Chrome --user-data-dir */
  profileDirOf(accountId: string): string;
}

export interface ResolveHubRootOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** 非 Windows 或缺少 LOCALAPPDATA 时的兜底根目录 */
  fallback: string;
}

/**
 * 解析顺序：
 *   1. DYHUB_ROOT          —— 测试隔离 / 自定义安装位置
 *   2. %LOCALAPPDATA%\DouyinAccountHub
 *   3. 调用方给的 fallback
 */
export function resolveHubRoot(options: ResolveHubRootOptions): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const override = env.DYHUB_ROOT;
  if (typeof override === 'string' && override.trim() !== '') {
    return path.resolve(override);
  }

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA;
    if (typeof localAppData === 'string' && localAppData.trim() !== '') {
      return path.join(localAppData, 'DouyinAccountHub');
    }
  }

  return path.resolve(options.fallback);
}

export interface CreateHubPathsOptions {
  /**
   * 覆盖 runtime 目录。
   *
   * 手动安装（install.cmd）时程序就在 `HUB_ROOT/runtime` 下，不用传；
   * 但 NSIS 安装版把程序装在别处，HUB_ROOT 只承载用户数据 —— 不覆盖的话，
   * 界面上的"程序位置"和"卸载"都会指向错误的对象。
   */
  runtimeRoot?: string | undefined;
}

export function createHubPaths(hubRoot: string, options: CreateHubPathsOptions = {}): HubPaths {
  const root = path.resolve(hubRoot);
  const dataRoot = path.join(root, 'data');
  const profilesRoot = path.join(dataRoot, 'profiles');
  const logsRoot = path.join(dataRoot, 'logs');

  return {
    hubRoot: root,
    runtimeRoot: options.runtimeRoot
      ? path.resolve(options.runtimeRoot)
      : path.join(root, 'runtime'),
    dataRoot,
    accountsFile: path.join(dataRoot, 'accounts.json'),
    profilesRoot,
    logsRoot,
    logFile: path.join(logsRoot, 'app.log'),
    profileDirOf: (accountId: string) => path.join(profilesRoot, accountId),
  };
}

/** 供 UI 展示的默认位置，不触碰文件系统。 */
export function defaultFallbackRoot(): string {
  return path.join(os.homedir(), '.douyin-account-hub');
}
