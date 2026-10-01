import { spawn } from 'node:child_process';

export interface LaunchSpec {
  /** 该账号专属的 Chrome --user-data-dir */
  profileDir: string;
  url: string;
  /** Chrome profile 名，默认 Default */
  profileDirectory?: string;
}

/**
 * 构造启动参数。
 *
 * **这是纯函数，也是本模块存在的理由**：`spawn` 本身在 DSH 沙箱里跑不了 Chromium，
 * 把参数构造抽出来，就能在没有浏览器的环境下把"参数对不对"这条验证做掉。
 *
 * 参数用数组返回而非拼字符串：Node 直接把数组映射成 argv，不经 shell，
 * 因此账号路径含空格或中文都不需要手工加引号（手工加引号反而会把引号带进路径）。
 */
export function buildLaunchArgs(spec: LaunchSpec): string[] {
  const profileDirectory = spec.profileDirectory ?? 'Default';

  return [
    `--user-data-dir=${spec.profileDir}`,
    `--profile-directory=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    spec.url,
  ];
}

/**
 * 以 detached 方式拉起浏览器并立刻脱钩。
 *
 * detached + unref 是硬要求：Chrome 必须在面板退出后继续存活，
 * 否则用户一关面板就断了自己的浏览会话。
 *
 * 不需要自己做窗口去重：Chrome 的单例以 --user-data-dir 为粒度（SingletonLock），
 * 同一账号再次点击时它会把 URL 转交给已有实例并立即退出，效果正是"聚焦已有窗口"。
 */
export function spawnBrowser(exePath: string, args: string[]): number | undefined {
  const child = spawn(exePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child.pid;
}
