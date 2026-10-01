import type { AccountView, BrowserInfo, HubApi, HubInfo, Result } from '../shared/types';

declare global {
  interface Window {
    hub: HubApi;
  }
}

const hub = window.hub;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const ui = {
  grid: el<HTMLDivElement>('grid'),
  empty: el<HTMLDivElement>('empty'),
  addBtn: el<HTMLButtonElement>('btn-add'),
  banner: el<HTMLDivElement>('banner'),
  bannerText: el<HTMLSpanElement>('banner-text'),
  bannerAction: el<HTMLButtonElement>('banner-action'),
  dataDirBtn: el<HTMLButtonElement>('btn-data-dir'),
  uninstallBtn: el<HTMLButtonElement>('btn-uninstall'),
  browserLine: el<HTMLSpanElement>('browser-line'),
  hubLine: el<HTMLSpanElement>('hub-line'),
  overlay: el<HTMLDivElement>('overlay'),
  dialogTitle: el<HTMLHeadingElement>('dialog-title'),
  dialogBody: el<HTMLDivElement>('dialog-body'),
  dialogOk: el<HTMLButtonElement>('dialog-ok'),
  dialogCancel: el<HTMLButtonElement>('dialog-cancel'),
  toast: el<HTMLDivElement>('toast'),
};

interface State {
  accounts: AccountView[];
  browser: BrowserInfo | null;
  hubInfo: HubInfo | null;
  storeCorrupt: boolean;
}

const state: State = { accounts: [], browser: null, hubInfo: null, storeCorrupt: false };

/* ------------------------------------------------------------------ */
/* 基础交互                                                            */
/* ------------------------------------------------------------------ */

let toastTimer: number | undefined;

function toast(message: string, isError = false): void {
  ui.toast.textContent = message;
  ui.toast.classList.toggle('error', isError);
  ui.toast.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.add('hidden'), 3600);
}

/** 失败一律弹提示并返回 null —— 绝不让错误静默消失。 */
function unwrap<T>(result: Result<T>): T | null {
  if (result.ok) return result.data;
  toast(result.message, true);
  return null;
}

let closeDialog: ((confirmed: boolean) => void) | null = null;

function showDialog(
  title: string,
  build: (body: HTMLDivElement) => void,
  confirmLabel: string,
): Promise<boolean> {
  ui.dialogTitle.textContent = title;
  ui.dialogBody.replaceChildren();
  ui.dialogOk.textContent = confirmLabel;
  build(ui.dialogBody);
  ui.overlay.classList.remove('hidden');

  return new Promise<boolean>((resolve) => {
    closeDialog = (confirmed: boolean) => {
      ui.overlay.classList.add('hidden');
      closeDialog = null;
      resolve(confirmed);
    };
  });
}

ui.dialogOk.addEventListener('click', () => closeDialog?.(true));
ui.dialogCancel.addEventListener('click', () => closeDialog?.(false));
document.addEventListener('keydown', (event) => {
  if (ui.overlay.classList.contains('hidden')) return;
  if (event.key === 'Escape') closeDialog?.(false);
  if (event.key === 'Enter') closeDialog?.(true);
});

async function askText(title: string, initial: string, confirmLabel: string): Promise<string | null> {
  let input: HTMLInputElement | null = null;
  const confirmed = await showDialog(
    title,
    (body) => {
      const field = document.createElement('input');
      field.type = 'text';
      field.maxLength = 40;
      field.value = initial;
      field.placeholder = '例如：主号';
      body.append(field);
      input = field;
      window.queueMicrotask(() => {
        field.focus();
        field.select();
      });
    },
    confirmLabel,
  );

  if (!confirmed || !input) return null;
  const value = (input as HTMLInputElement).value.trim();
  if (value === '') {
    toast('名字不能为空', true);
    return null;
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function formatTime(iso: string | null): string {
  if (!iso) return '还没打开过';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '还没打开过';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '刚刚打开过';
  if (minutes < 60) return `${minutes} 分钟前打开过`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前打开过`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 360000;
  }
  return hash % 360;
}

function firstChar(label: string): string {
  return label.trim().charAt(0) || '?';
}

function buildCard(account: AccountView): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = firstChar(account.label);
  const hue = hueOf(account.id);
  avatar.style.background = `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 70% 42%))`;

  const info = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = account.label;

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.textContent = formatTime(account.lastOpenedAt);

  info.append(name, meta);

  if (!account.profileExists) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '登录数据已丢失，需重新登录';
    info.append(badge);
  }

  head.append(avatar, info);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'primary grow';
  openBtn.textContent = '打开创作者中心';
  openBtn.addEventListener('click', () => void openAccount(account, openBtn));

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'ghost icon';
  renameBtn.title = '重命名';
  renameBtn.textContent = '改名';
  renameBtn.addEventListener('click', () => void renameAccount(account));

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'ghost danger icon';
  removeBtn.title = '删除';
  removeBtn.textContent = '删除';
  removeBtn.addEventListener('click', () => void removeAccount(account));

  actions.append(openBtn, renameBtn, removeBtn);

  card.append(head, actions);
  return card;
}

function render(): void {
  ui.grid.replaceChildren(...state.accounts.map(buildCard));
  ui.empty.classList.toggle('hidden', state.accounts.length > 0);

  renderBanner();
  renderFooter();
}

function renderBanner(): void {
  const browser = state.browser;
  let text = '';
  let isError = false;
  let showAction = false;

  if (state.storeCorrupt) {
    text = '账号数据文件损坏，已自动备份原文件并以空列表启动。备份文件在数据目录里，后缀为 .corrupt-*。';
    isError = true;
  } else if (!browser || browser.kind === 'none') {
    text = '没有找到 Chrome 或 Edge。请手动指定 chrome.exe 的路径，否则打不开账号。';
    isError = true;
    showAction = true;
  } else if (browser.isFallback) {
    text = `没有找到 Chrome，将使用 Edge（${browser.path}）打开。Edge 与 Chrome 的登录状态互不相通。`;
    showAction = true;
  }

  ui.banner.classList.toggle('hidden', text === '');
  ui.banner.classList.toggle('error', isError);
  ui.bannerText.textContent = text;
  ui.bannerAction.classList.toggle('hidden', !showAction);
}

function renderFooter(): void {
  const browser = state.browser;
  if (!browser || browser.kind === 'none') {
    ui.browserLine.textContent = '浏览器：未找到';
  } else {
    const label = browser.kind === 'custom' ? '手动指定' : browser.kind === 'edge' ? 'Edge' : 'Chrome';
    ui.browserLine.textContent = `浏览器：${label} · ${browser.path ?? ''}`;
  }
  ui.hubLine.textContent = state.hubInfo ? `数据目录：${state.hubInfo.dataRoot}` : '';
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

async function refresh(): Promise<void> {
  const accounts = unwrap(await hub.listAccounts());
  if (accounts) state.accounts = accounts;

  const browser = unwrap(await hub.getBrowser());
  if (browser) state.browser = browser;

  const info = unwrap(await hub.getHubInfo());
  if (info) state.hubInfo = info;

  render();
}

async function openAccount(account: AccountView, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.textContent = '正在打开…';
  try {
    const result = await hub.openAccount(account.id, 'home');
    if (result.ok) {
      toast(`已打开「${account.label}」`);
      await refresh();
    } else {
      toast(result.message, true);
      if (result.code === 'BROWSER_NOT_FOUND' || result.code === 'BROWSER_LAUNCH_FAILED') {
        await refresh();
      }
    }
  } finally {
    button.disabled = false;
    button.textContent = '打开创作者中心';
  }
}

async function addAccount(): Promise<void> {
  const label = await askText('添加账号', `账号 ${state.accounts.length + 1}`, '创建并登录');
  if (label === null) return;

  const created = unwrap(await hub.addAccount(label));
  if (!created) return;

  await refresh();

  // 添加后立刻把登录页打开 —— 让用户这一趟就把扫码做完，而不是回头再点一次。
  const result = await hub.openAccount(created.id, 'home');
  if (result.ok) {
    toast('已打开登录页，扫码完成后关闭浏览器也不会掉登录');
    await refresh();
  } else {
    toast(result.message, true);
  }
}

async function renameAccount(account: AccountView): Promise<void> {
  const label = await askText('重命名账号', account.label, '保存');
  if (label === null || label === account.label) return;

  const updated = unwrap(await hub.renameAccount(account.id, label));
  if (!updated) return;
  await refresh();
  toast('已重命名');
}

async function removeAccount(account: AccountView): Promise<void> {
  let withData = true;

  const confirmed = await showDialog(
    '删除账号',
    (body) => {
      const question = document.createElement('p');
      question.textContent = `确定要删除「${account.label}」吗？`;
      question.style.margin = '0 0 4px';
      body.append(question);

      const wrap = document.createElement('label');
      wrap.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = true;
      const text = document.createElement('span');
      text.textContent = '同时删除该账号的登录数据（不勾选则只从列表移除，登录状态保留）';
      box.addEventListener('change', () => {
        withData = box.checked;
      });
      wrap.append(box, text);
      body.append(wrap);
    },
    '删除',
  );

  if (!confirmed) return;

  // 这里不能用 unwrap：删除成功的 data 本身就是 null，与失败无法区分。
  const result = await hub.removeAccount(account.id, withData);
  if (!result.ok) {
    toast(result.message, true);
    return;
  }

  await refresh();
  toast(withData ? '已删除账号及其登录数据' : '已移除账号（登录数据保留）');
}

/* ------------------------------------------------------------------ */
/* 顶部与底部按钮                                                       */
/* ------------------------------------------------------------------ */

ui.addBtn.addEventListener('click', () => void addAccount());

ui.bannerAction.addEventListener('click', () => void pickBrowser());

async function pickBrowser(): Promise<void> {
  const info = unwrap(await hub.pickBrowserPath());
  if (!info) return;
  state.browser = info;
  render();
  toast(info.kind === 'none' ? '仍未找到可用浏览器' : '已指定浏览器', info.kind === 'none');
}

ui.dataDirBtn.addEventListener('click', async () => {
  const result = await hub.revealDataDir();
  if (!result.ok) toast(result.message, true);
});

ui.uninstallBtn.addEventListener('click', async () => {
  const confirmed = await showDialog(
    '卸载应用',
    (body) => {
      const lines = [
        '将删除以下内容：',
        `· 程序本体：${state.hubInfo?.runtimeRoot ?? '(未知)'}`,
        `· 账号数据与登录状态：${state.hubInfo?.dataRoot ?? '(未知)'}`,
        '',
        '删除后 4 个账号都需要重新扫码登录，且无法恢复。',
      ];
      for (const line of lines) {
        const p = document.createElement('div');
        p.textContent = line;
        body.append(p);
      }
    },
    '确认卸载',
  );

  if (!confirmed) return;

  const result = await hub.uninstall();
  if (!result.ok) toast(result.message, true);
});

/* ------------------------------------------------------------------ */

void refresh();
