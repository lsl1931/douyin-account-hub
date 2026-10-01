import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountView,
  BrowserInfo,
  HubApi,
  HubInfo,
  OpenTarget,
  Result,
} from './shared/types';

/**
 * 渲染层唯一的对外通道。
 *
 * 刻意**不**暴露裸 ipcRenderer：渲染层因此无法调用任何未在此列出的 channel，
 * 即使某个 XSS 或第三方脚本进来也拿不到额外的能力。
 */
const api: HubApi = {
  listAccounts: () => ipcRenderer.invoke('hub:list') as Promise<Result<AccountView[]>>,
  addAccount: (label: string) => ipcRenderer.invoke('hub:add', label) as Promise<Result<AccountView>>,
  renameAccount: (id: string, label: string) =>
    ipcRenderer.invoke('hub:rename', id, label) as Promise<Result<AccountView>>,
  removeAccount: (id: string, deleteProfile: boolean) =>
    ipcRenderer.invoke('hub:remove', id, deleteProfile) as Promise<Result<null>>,
  openAccount: (id: string, target: OpenTarget) =>
    ipcRenderer.invoke('hub:open', id, target) as Promise<Result<null>>,
  getBrowser: () => ipcRenderer.invoke('hub:getBrowser') as Promise<Result<BrowserInfo>>,
  setBrowserPath: (browserPath: string | null) =>
    ipcRenderer.invoke('hub:setBrowserPath', browserPath) as Promise<Result<BrowserInfo>>,
  pickBrowserPath: () => ipcRenderer.invoke('hub:pickBrowserPath') as Promise<Result<BrowserInfo>>,
  revealDataDir: () => ipcRenderer.invoke('hub:revealDataDir') as Promise<Result<null>>,
  getHubInfo: () => ipcRenderer.invoke('hub:getHubInfo') as Promise<Result<HubInfo>>,
  uninstall: () => ipcRenderer.invoke('hub:uninstall') as Promise<Result<null>>,
};

contextBridge.exposeInMainWorld('hub', api);
