/**
 * 主进程与渲染层共享的类型。
 *
 * 约定：本文件**只放类型**，不放运行时值。
 * 渲染层用 `import type` 引入，编译后被完全擦除，因此不需要打包器。
 */

export type ErrorCode =
  | 'BROWSER_NOT_FOUND'
  | 'BROWSER_LAUNCH_FAILED'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_LABEL_EMPTY'
  | 'STORE_WRITE_FAILED'
  | 'STORE_CORRUPT'
  | 'UNINSTALL_FAILED'
  | 'INTERNAL';

/** 所有 IPC 一律返回 Result，不 reject —— reject 跨进程序列化会丢掉 code。 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

/** 打开账号的目标页 */
export type OpenTarget = 'home';

export interface Account {
  /** uuid v4，同时是 profile 目录名 */
  id: string;
  /** 用户自定义备注名 */
  label: string;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface Settings {
  /** 自动探测失败时由用户手动指定的浏览器可执行文件路径 */
  browserPath: string | null;
}

export interface AccountFile {
  schemaVersion: number;
  settings: Settings;
  accounts: Account[];
}

/** 传给渲染层的账号视图 */
export interface AccountView extends Account {
  profileDir: string;
  /** profile 目录是否还在（被手工删除时为 false） */
  profileExists: boolean;
}

export type BrowserKind = 'chrome' | 'edge' | 'custom' | 'none';

export interface BrowserInfo {
  path: string | null;
  kind: BrowserKind;
  /** 是否为兜底选择（Edge），UI 需明示 */
  isFallback: boolean;
}

/** 渲染层可见的完整 API 面 */
export interface HubApi {
  listAccounts(): Promise<Result<AccountView[]>>;
  addAccount(label: string): Promise<Result<AccountView>>;
  renameAccount(id: string, label: string): Promise<Result<AccountView>>;
  removeAccount(id: string, deleteProfile: boolean): Promise<Result<null>>;
  openAccount(id: string, target: OpenTarget): Promise<Result<null>>;
  getBrowser(): Promise<Result<BrowserInfo>>;
  setBrowserPath(path: string | null): Promise<Result<BrowserInfo>>;
  pickBrowserPath(): Promise<Result<BrowserInfo>>;
  revealDataDir(): Promise<Result<null>>;
  getHubInfo(): Promise<Result<HubInfo>>;
  uninstall(): Promise<Result<null>>;
}

export interface HubInfo {
  hubRoot: string;
  dataRoot: string;
  runtimeRoot: string;
  logFile: string;
}
