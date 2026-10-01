import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Account, AccountFile, Settings } from '../shared/types';

const SCHEMA_VERSION = 1;

export interface LoadReport {
  /** 原文件损坏时，被备份到的路径 */
  corruptBackup: string | null;
}

function emptyState(): AccountFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { browserPath: null },
    accounts: [],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coerceAccount(raw: unknown): Account | null {
  if (!isRecord(raw)) return null;
  const { id, label, createdAt, lastOpenedAt } = raw;
  if (typeof id !== 'string' || id.trim() === '') return null;
  if (typeof label !== 'string') return null;
  return {
    id,
    label,
    createdAt: typeof createdAt === 'string' ? createdAt : new Date().toISOString(),
    lastOpenedAt: typeof lastOpenedAt === 'string' ? lastOpenedAt : null,
  };
}

/**
 * 账号注册表。唯一真相源是磁盘上的 accounts.json。
 *
 * 两条不可让步的规则：
 *  - 写盘必须原子（tmp + rename），否则断电会留下半截文件把用户数据全毁掉。
 *  - JSON 损坏时**必须备份再降级**，绝不静默清空 —— 里面有用户 4 个账号的映射。
 */
export class AccountStore {
  private state: AccountFile = emptyState();
  private lastLoadReport: LoadReport = { corruptBackup: null };

  constructor(private readonly file: string) {}

  get path(): string {
    return this.file;
  }

  get loadReport(): LoadReport {
    return this.lastLoadReport;
  }

  load(): LoadReport {
    this.lastLoadReport = { corruptBackup: null };

    if (!fs.existsSync(this.file)) {
      this.state = emptyState();
      return this.lastLoadReport;
    }

    const raw = fs.readFileSync(this.file, 'utf8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 备份而不是删除。用户的数据永远不因为我们的解析失败而消失。
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, backup);
      this.lastLoadReport = { corruptBackup: backup };
      this.state = emptyState();
      return this.lastLoadReport;
    }

    this.state = this.normalize(parsed);
    return this.lastLoadReport;
  }

  private normalize(parsed: unknown): AccountFile {
    const next = emptyState();
    if (!isRecord(parsed)) return next;

    const settings = parsed.settings;
    if (isRecord(settings) && typeof settings.browserPath === 'string') {
      next.settings.browserPath = settings.browserPath;
    }

    const accounts = parsed.accounts;
    if (Array.isArray(accounts)) {
      const seen = new Set<string>();
      for (const entry of accounts) {
        const account = coerceAccount(entry);
        if (account && !seen.has(account.id)) {
          seen.add(account.id);
          next.accounts.push(account);
        }
      }
    }

    return next;
  }

  list(): Account[] {
    return this.state.accounts.map((a) => ({ ...a }));
  }

  find(id: string): Account | null {
    const hit = this.state.accounts.find((a) => a.id === id);
    return hit ? { ...hit } : null;
  }

  settings(): Settings {
    return { ...this.state.settings };
  }

  setBrowserPath(browserPath: string | null): void {
    this.state.settings.browserPath = browserPath;
    this.persist();
  }

  add(label: string): Account {
    const account: Account = {
      id: crypto.randomUUID(),
      label,
      createdAt: new Date().toISOString(),
      lastOpenedAt: null,
    };
    this.state.accounts.push(account);
    this.persist();
    return { ...account };
  }

  rename(id: string, label: string): Account | null {
    const hit = this.state.accounts.find((a) => a.id === id);
    if (!hit) return null;
    hit.label = label;
    this.persist();
    return { ...hit };
  }

  touch(id: string): Account | null {
    const hit = this.state.accounts.find((a) => a.id === id);
    if (!hit) return null;
    hit.lastOpenedAt = new Date().toISOString();
    this.persist();
    return { ...hit };
  }

  remove(id: string): Account | null {
    const index = this.state.accounts.findIndex((a) => a.id === id);
    if (index < 0) return null;
    const [removed] = this.state.accounts.splice(index, 1);
    this.persist();
    return removed ? { ...removed } : null;
  }

  private persist(): void {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });

    // 原子写：同目录 rename 在 Windows 上走 MoveFileEx(MOVEFILE_REPLACE_EXISTING)，
    // 可以覆盖已存在文件，不会留下半截内容。
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }
}
