import fs from 'node:fs';
import path from 'node:path';
import type { BrowserInfo } from '../shared/types';

export interface BrowserCandidate {
  path: string;
  kind: 'chrome' | 'edge';
  /** 兜底项（Edge）：UI 必须明示，因为它的登录态行为与 Chrome 不完全一致 */
  isFallback: boolean;
}

export interface LocateOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** 注入以便单测，默认 fs.existsSync */
  exists?: (candidate: string) => boolean;
  /** 用户在设置里手动指定的路径，优先级最高 */
  customPath?: string | null;
}

/**
 * 候选顺序即优先级。
 *
 * 刻意不查注册表 App Paths：那需要起子进程跑 `reg query`，既拖慢启动也让单测变脏；
 * 三条 Chrome 标准路径已覆盖绝大多数安装，剩下的由"手动指定"兜底。
 */
export function candidatePaths(options: LocateOptions = {}): BrowserCandidate[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return [];

  const programFiles = env.ProgramFiles ?? env.PROGRAMFILES ?? '';
  const programFilesX86 = env['ProgramFiles(x86)'] ?? '';
  const localAppData = env.LOCALAPPDATA ?? '';

  const out: BrowserCandidate[] = [];
  const push = (base: string, rest: string, kind: 'chrome' | 'edge', isFallback: boolean) => {
    if (!base) return;
    out.push({ path: path.join(base, rest), kind, isFallback });
  };

  push(programFiles, 'Google\\Chrome\\Application\\chrome.exe', 'chrome', false);
  push(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe', 'chrome', false);
  push(localAppData, 'Google\\Chrome\\Application\\chrome.exe', 'chrome', false);
  push(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe', 'edge', true);
  push(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe', 'edge', true);

  return out;
}

export function locateBrowser(options: LocateOptions = {}): BrowserInfo {
  const exists = options.exists ?? ((p: string) => fs.existsSync(p));

  const custom = options.customPath;
  if (typeof custom === 'string' && custom.trim() !== '' && exists(custom)) {
    return { path: custom, kind: 'custom', isFallback: false };
  }

  for (const candidate of candidatePaths(options)) {
    if (exists(candidate.path)) {
      return { path: candidate.path, kind: candidate.kind, isFallback: candidate.isFallback };
    }
  }

  return { path: null, kind: 'none', isFallback: false };
}
