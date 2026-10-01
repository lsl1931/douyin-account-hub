import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { candidatePaths, locateBrowser } from '../main/browserLocator';

const winEnv = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
};

test('候选顺序：Chrome 三连在前，Edge 兜底在后', () => {
  const list = candidatePaths({ env: winEnv, platform: 'win32' });
  assert.equal(list.length, 5);
  assert.ok(list.slice(0, 3).every((c) => c.kind === 'chrome'));
  assert.ok(list.slice(3).every((c) => c.kind === 'edge'));
  assert.ok(list.slice(0, 3).every((c) => c.isFallback === false));
  assert.ok(list.slice(3).every((c) => c.isFallback === true));
  assert.equal(list[0]?.path, path.join('C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'));
});

test('非 Windows 无候选', () => {
  assert.deepEqual(candidatePaths({ env: winEnv, platform: 'darwin' }), []);
  const info = locateBrowser({ env: winEnv, platform: 'darwin', exists: () => true });
  assert.equal(info.kind, 'none');
  assert.equal(info.path, null);
});

test('命中第一个存在的 Chrome，且不标记为兜底', () => {
  const target = path.join('C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe');
  const info = locateBrowser({
    env: winEnv,
    platform: 'win32',
    exists: (p) => p === target,
  });
  assert.equal(info.path, target);
  assert.equal(info.kind, 'chrome');
  assert.equal(info.isFallback, false);
});

test('只有 Edge 存在时标记 isFallback=true —— UI 必须据此告警', () => {
  const info = locateBrowser({
    env: winEnv,
    platform: 'win32',
    exists: (p) => p.toLowerCase().includes('msedge'),
  });
  assert.equal(info.kind, 'edge');
  assert.equal(info.isFallback, true);
  assert.ok(info.path);
});

test('手动指定的路径优先级最高', () => {
  const custom = 'D:\\portable\\chrome.exe';
  const info = locateBrowser({
    env: winEnv,
    platform: 'win32',
    customPath: custom,
    exists: (p) => p === custom || p === path.join('C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
  });
  assert.equal(info.path, custom);
  assert.equal(info.kind, 'custom');
  assert.equal(info.isFallback, false);
});

test('手动指定但文件不存在时回落到自动探测，不返回幽灵路径', () => {
  const real = path.join('C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe');
  const info = locateBrowser({
    env: winEnv,
    platform: 'win32',
    customPath: 'D:\\nope\\chrome.exe',
    exists: (p) => p === real,
  });
  assert.equal(info.path, real);
  assert.equal(info.kind, 'chrome');
});

test('全都找不到时返回 none 而不是抛异常', () => {
  const info = locateBrowser({ env: winEnv, platform: 'win32', exists: () => false });
  assert.equal(info.kind, 'none');
  assert.equal(info.path, null);
});

test('缺 ProgramFiles 环境变量时不产生空路径候选', () => {
  const list = candidatePaths({ env: { LOCALAPPDATA: 'C:\\L' }, platform: 'win32' });
  assert.ok(list.length > 0);
  assert.ok(list.every((c) => path.isAbsolute(c.path)));
  assert.ok(list.every((c) => !c.path.includes('Google\\Chrome\\Application') || c.path.startsWith('C:\\L')));
});
