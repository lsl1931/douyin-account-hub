import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createHubPaths, resolveHubRoot } from './paths';
import { AccountStore } from './accountStore';
import { Logger } from './logger';
import { registerIpc } from './ipc';
import { finishSelfTest, runSelfTest, selfTestRequested } from './selftest';

/**
 * 单实例锁。
 *
 * 不只是体验问题：两个面板实例会同时读写同一份 accounts.json，
 * 原子写能保证文件不烂，但后写的那个会覆盖先写的，用户的账号会莫名消失。
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  const hubRoot = resolveHubRoot({ fallback: app.getPath('userData') });
  const paths = createHubPaths(hubRoot, {
    // 安装版把程序装在别处（NSIS 的安装目录），HUB_ROOT 只放用户数据。
    // 不覆盖的话，"数据目录"按钮之外的运行时信息与卸载目标都会指错。
    runtimeRoot: app.isPackaged ? path.dirname(process.execPath) : undefined,
  });
  const logger = new Logger(paths.logFile);
  const store = new AccountStore(paths.accountsFile);

  let mainWindow: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app
    .whenReady()
    .then(async () => {
      logger.info(`启动 面板 hubRoot=${paths.hubRoot} userData=${paths.dataRoot}`);

      const report = store.load();
      if (report.corruptBackup) {
        logger.error(
          `accounts.json 解析失败，已备份到 ${report.corruptBackup}，本次以空列表启动（原文件未被删除）`,
        );
      }

      registerIpc({ paths, store, logger });

      if (selfTestRequested(process.argv)) {
        const failed = await runSelfTest(
          { paths, store, logger },
          path.join(__dirname, '..', 'renderer'),
        );
        await finishSelfTest(failed);
        return;
      }

      mainWindow = createMainWindow();
    })
    .catch((err: unknown) => {
      logger.error(`启动失败: ${String(err)}`);
      app.quit();
    });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 740,
    minWidth: 760,
    minHeight: 540,
    title: '抖音账号面板',
    icon: path.join(__dirname, '..', 'icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  return window;
}
