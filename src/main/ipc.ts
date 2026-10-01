import { ipcMain, dialog, shell, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Account, AccountView, BrowserInfo, HubInfo, OpenTarget, Result } from '../shared/types';
import type { AccountStore } from './accountStore';
import type { HubPaths } from './paths';
import type { Logger } from './logger';
import { locateBrowser } from './browserLocator';
import { buildLaunchArgs, spawnBrowser } from './browserLauncher';
import { urlForTarget } from './douyin';
import { fail, fromError, ok } from './result';

export interface AppContext {
  paths: HubPaths;
  store: AccountStore;
  logger: Logger;
}

const MAX_LABEL_LENGTH = 40;

function toView(account: Account, paths: HubPaths): AccountView {
  const profileDir = paths.profileDirOf(account.id);
  return {
    ...account,
    profileDir,
    profileExists: fs.existsSync(profileDir),
  };
}

function currentBrowser(ctx: AppContext): BrowserInfo {
  return locateBrowser({ customPath: ctx.store.settings().browserPath });
}

function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const label = raw.trim();
  if (label === '') return null;
  return label.slice(0, MAX_LABEL_LENGTH);
}

/**
 * 注册全部 IPC。
 *
 * 这里的 channel 列表就是渲染层能触达的全部能力 —— preload 只转发这些名字，
 * 不暴露裸 ipcRenderer。两者必须一一对应。
 */
export function registerIpc(ctx: AppContext): void {
  const { paths, store, logger } = ctx;

  ipcMain.handle('hub:list', (): Result<AccountView[]> => {
    try {
      return ok(store.list().map((a) => toView(a, paths)));
    } catch (err) {
      logger.error(`hub:list 失败: ${String(err)}`);
      return fromError('INTERNAL', err);
    }
  });

  ipcMain.handle('hub:add', (_event, rawLabel: unknown): Result<AccountView> => {
    try {
      const label = cleanLabel(rawLabel);
      if (!label) return fail('ACCOUNT_LABEL_EMPTY', '账号备注名不能为空');

      const account = store.add(label);
      fs.mkdirSync(paths.profileDirOf(account.id), { recursive: true });
      logger.info(`新增账号 ${account.id} (${label}), profile=${paths.profileDirOf(account.id)}`);
      return ok(toView(account, paths));
    } catch (err) {
      logger.error(`hub:add 失败: ${String(err)}`);
      return fromError('STORE_WRITE_FAILED', err);
    }
  });

  ipcMain.handle('hub:rename', (_event, id: unknown, rawLabel: unknown): Result<AccountView> => {
    try {
      if (typeof id !== 'string') return fail('ACCOUNT_NOT_FOUND', '账号 id 无效');
      const label = cleanLabel(rawLabel);
      if (!label) return fail('ACCOUNT_LABEL_EMPTY', '账号备注名不能为空');

      const updated = store.rename(id, label);
      if (!updated) return fail('ACCOUNT_NOT_FOUND', '账号不存在');
      return ok(toView(updated, paths));
    } catch (err) {
      logger.error(`hub:rename 失败: ${String(err)}`);
      return fromError('STORE_WRITE_FAILED', err);
    }
  });

  ipcMain.handle('hub:remove', (_event, id: unknown, deleteProfile: unknown): Result<null> => {
    try {
      if (typeof id !== 'string') return fail('ACCOUNT_NOT_FOUND', '账号 id 无效');

      const removed = store.remove(id);
      if (!removed) return fail('ACCOUNT_NOT_FOUND', '账号不存在');

      if (deleteProfile === true) {
        const dir = paths.profileDirOf(id);
        fs.rmSync(dir, { recursive: true, force: true });
        logger.info(`已删除账号 ${id} 及其登录数据: ${dir}`);
      } else {
        logger.info(`已移除账号 ${id}（保留登录数据）`);
      }
      return ok(null);
    } catch (err) {
      logger.error(`hub:remove 失败: ${String(err)}`);
      return fromError('INTERNAL', err);
    }
  });

  ipcMain.handle('hub:open', (_event, id: unknown, target: unknown): Result<null> => {
    try {
      if (typeof id !== 'string') return fail('ACCOUNT_NOT_FOUND', '账号 id 无效');
      const account = store.find(id);
      if (!account) return fail('ACCOUNT_NOT_FOUND', '账号不存在');

      const browser = currentBrowser(ctx);
      if (!browser.path) {
        return fail('BROWSER_NOT_FOUND', '没有找到可用的浏览器，请手动指定 Chrome 的路径');
      }

      const profileDir = paths.profileDirOf(id);
      fs.mkdirSync(profileDir, { recursive: true });

      const url = urlForTarget((target ?? 'home') as OpenTarget);
      const args = buildLaunchArgs({ profileDir, url });

      // 把完整命令行写进日志：启动失败时这是唯一能自证的证据。
      logger.info(`启动浏览器: "${browser.path}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);

      spawnBrowser(browser.path, args);
      store.touch(id);
      return ok(null);
    } catch (err) {
      logger.error(`hub:open 失败: ${String(err)}`);
      return fromError('BROWSER_LAUNCH_FAILED', err);
    }
  });

  ipcMain.handle('hub:getBrowser', (): Result<BrowserInfo> => {
    try {
      return ok(currentBrowser(ctx));
    } catch (err) {
      return fromError('INTERNAL', err);
    }
  });

  ipcMain.handle('hub:setBrowserPath', (_event, rawPath: unknown): Result<BrowserInfo> => {
    try {
      if (rawPath !== null && typeof rawPath !== 'string') {
        return fail('INTERNAL', '路径必须是字符串或 null');
      }
      const next = typeof rawPath === 'string' && rawPath.trim() !== '' ? rawPath.trim() : null;
      if (next !== null && !fs.existsSync(next)) {
        return fail('BROWSER_NOT_FOUND', `该路径不存在：${next}`);
      }
      store.setBrowserPath(next);
      logger.info(`手动指定浏览器: ${next ?? '(已清除，回到自动探测)'}`);
      return ok(currentBrowser(ctx));
    } catch (err) {
      return fromError('STORE_WRITE_FAILED', err);
    }
  });

  ipcMain.handle('hub:pickBrowserPath', async (): Promise<Result<BrowserInfo>> => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择浏览器可执行文件',
        properties: ['openFile'],
        filters: [{ name: '可执行文件', extensions: ['exe'] }],
      });
      const picked = result.filePaths[0];
      if (result.canceled || !picked) {
        return ok(currentBrowser(ctx));
      }
      store.setBrowserPath(picked);
      logger.info(`手动指定浏览器: ${picked}`);
      return ok(currentBrowser(ctx));
    } catch (err) {
      return fromError('INTERNAL', err);
    }
  });

  ipcMain.handle('hub:getHubInfo', (): Result<HubInfo> => {
    return ok({
      hubRoot: paths.hubRoot,
      dataRoot: paths.dataRoot,
      runtimeRoot: paths.runtimeRoot,
      logFile: paths.logFile,
    });
  });

  ipcMain.handle('hub:revealDataDir', async (): Promise<Result<null>> => {
    try {
      fs.mkdirSync(paths.dataRoot, { recursive: true });
      const message = await shell.openPath(paths.dataRoot);
      if (message) return fail('INTERNAL', message);
      return ok(null);
    } catch (err) {
      return fromError('INTERNAL', err);
    }
  });

  ipcMain.handle('hub:uninstall', (): Result<null> => {
    try {
      if (app.isPackaged) return uninstallPackaged(ctx);

      const script = path.join(paths.hubRoot, 'uninstall.cmd');
      if (!fs.existsSync(script)) {
        return fail('UNINSTALL_FAILED', `卸载脚本不存在：${script}`);
      }

      logger.info(`执行卸载（手动安装）: ${script} ${process.pid}`);
      const child = spawn(script, [String(process.pid)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();

      // 让脚本先把窗口关掉再删文件；延迟退出给 spawn 留出落地时间。
      setTimeout(() => app.quit(), 400);
      return ok(null);
    } catch (err) {
      logger.error(`hub:uninstall 失败: ${String(err)}`);
      return fromError('UNINSTALL_FAILED', err);
    }
  });
}

/** NSIS 生成的卸载程序通常叫 `Uninstall <ProductName>.exe`，但不保证，所以按前缀找。 */
function findNsisUninstaller(installDir: string): string | null {
  try {
    const hit = fs.readdirSync(installDir).find((name) => /^uninstall.*\.exe$/i.test(name));
    return hit ? path.join(installDir, hit) : null;
  } catch {
    return null;
  }
}

/**
 * 安装版（NSIS）的卸载。
 *
 * 与手动安装的关键差别：NSIS 只负责删自己的安装目录，**不会碰用户数据**。
 * 而用户的预期是"卸载 = 连登录态一起清干净"，所以数据目录必须由我们自己删。
 * 删不干净时不阻塞卸载流程 —— 卸载程序该走还得走，留下的残渣记进日志。
 */
function uninstallPackaged(ctx: AppContext): Result<null> {
  const { paths, logger } = ctx;

  const uninstaller = findNsisUninstaller(paths.runtimeRoot);
  if (!uninstaller) {
    return fail(
      'UNINSTALL_FAILED',
      `没有在安装目录里找到卸载程序。请改用 Windows「设置 → 应用」卸载。安装目录：${paths.runtimeRoot}`,
    );
  }

  try {
    fs.rmSync(paths.dataRoot, { recursive: true, force: true });
    logger.info(`已删除用户数据目录：${paths.dataRoot}`);
  } catch (err) {
    // 多半是某个账号的浏览器还开着，占住了 profile 文件。不阻塞卸载。
    logger.warn(`用户数据目录未能完全删除（可能浏览器仍开着）：${String(err)}`);
  }

  logger.info(`执行卸载（安装版）: ${uninstaller}`);
  spawn(uninstaller, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();

  setTimeout(() => app.quit(), 400);
  return ok(null);
}
