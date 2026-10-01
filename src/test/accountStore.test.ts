import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from '../main/accountStore';

function freshStore(): { store: AccountStore; dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyhub-store-'));
  const file = path.join(dir, 'accounts.json');
  return { store: new AccountStore(file), dir, file };
}

test('文件不存在时返回空表且不抛错', () => {
  const { store } = freshStore();
  const report = store.load();
  assert.deepEqual(store.list(), []);
  assert.equal(report.corruptBackup, null);
  assert.equal(store.settings().browserPath, null);
});

test('增删改往返一致，且重新 load 后仍然存在', () => {
  const { store, file } = freshStore();
  store.load();

  const a = store.add('主号');
  const b = store.add('美食号');
  assert.notEqual(a.id, b.id);
  store.rename(a.id, '主号-改');
  store.touch(b.id);

  const reopened = new AccountStore(file);
  reopened.load();
  const list = reopened.list();
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.id === a.id)?.label, '主号-改');
  assert.ok(list.find((x) => x.id === b.id)?.lastOpenedAt);
});

test('写入是原子的 —— 不留下 .tmp 残留', () => {
  const { store, dir } = freshStore();
  store.load();
  store.add('甲');
  const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('连续 20 次写入后文件始终是合法 JSON', () => {
  const { store, file, dir } = freshStore();
  store.load();
  for (let i = 0; i < 20; i += 1) store.add(`账号-${i}`);
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw) as { accounts: unknown[] };
  assert.equal(parsed.accounts.length, 20);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});

test('JSON 损坏时：备份原文件、不崩溃、不静默清空数据', () => {
  const { store, dir, file } = freshStore();
  const original = '{ this is not json';
  fs.writeFileSync(file, original, 'utf8');

  const report = store.load();

  assert.ok(report.corruptBackup, '必须产生备份路径');
  assert.ok(fs.existsSync(report.corruptBackup as string), '备份文件必须真的存在');
  assert.equal(fs.readFileSync(report.corruptBackup as string, 'utf8'), original, '备份内容必须是原文');
  assert.deepEqual(store.list(), [], '损坏后以空表启动');
  assert.ok(!fs.existsSync(file), '损坏文件应已被移走而非留在原地');

  const backups = fs.readdirSync(dir).filter((n) => n.includes('.corrupt-'));
  assert.equal(backups.length, 1);
});

test('结构合法但内容残缺时：丢弃非法条目，保留合法条目', () => {
  const { store, file } = freshStore();
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      settings: { browserPath: 'C:\\chrome.exe' },
      accounts: [
        { id: 'ok-1', label: '合法', createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: null },
        { id: '', label: '空 id 应被丢' },
        { label: '缺 id 应被丢' },
        null,
        { id: 'ok-2', label: '也合法' },
      ],
    }),
    'utf8',
  );

  store.load();
  const list = store.list();
  assert.deepEqual(
    list.map((x) => x.id),
    ['ok-1', 'ok-2'],
  );
  assert.equal(store.settings().browserPath, 'C:\\chrome.exe');
});

test('重复 id 只保留第一次出现', () => {
  const { store, file } = freshStore();
  fs.writeFileSync(
    file,
    JSON.stringify({
      schemaVersion: 1,
      settings: { browserPath: null },
      accounts: [
        { id: 'dup', label: '先' },
        { id: 'dup', label: '后' },
      ],
    }),
    'utf8',
  );
  store.load();
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0]?.label, '先');
});

test('对不存在的 id 操作返回 null 而不是抛异常', () => {
  const { store } = freshStore();
  store.load();
  assert.equal(store.rename('nope', 'x'), null);
  assert.equal(store.touch('nope'), null);
  assert.equal(store.remove('nope'), null);
  assert.equal(store.find('nope'), null);
});

test('remove 之后磁盘上也消失', () => {
  const { store, file } = freshStore();
  store.load();
  const a = store.add('要被删的');
  store.remove(a.id);
  const reopened = new AccountStore(file);
  reopened.load();
  assert.deepEqual(reopened.list(), []);
});
