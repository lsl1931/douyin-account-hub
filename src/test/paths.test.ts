import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveHubRoot, createHubPaths } from '../main/paths';

test('DYHUB_ROOT 优先于 LOCALAPPDATA', () => {
  const root = resolveHubRoot({
    env: { DYHUB_ROOT: 'C:\\custom\\hub', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
    platform: 'win32',
    fallback: 'C:\\fallback',
  });
  assert.equal(root, path.resolve('C:\\custom\\hub'));
});

test('Windows 下缺 DYHUB_ROOT 时走 LOCALAPPDATA\\DouyinAccountHub', () => {
  const root = resolveHubRoot({
    env: { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
    platform: 'win32',
    fallback: 'C:\\fallback',
  });
  assert.equal(root, path.join('C:\\Users\\x\\AppData\\Local', 'DouyinAccountHub'));
});

test('Windows 但缺 LOCALAPPDATA 时退到 fallback', () => {
  const root = resolveHubRoot({ env: {}, platform: 'win32', fallback: 'C:\\fallback' });
  assert.equal(root, path.resolve('C:\\fallback'));
});

test('空字符串的 DYHUB_ROOT 不算覆盖', () => {
  const root = resolveHubRoot({
    env: { DYHUB_ROOT: '   ', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' },
    platform: 'win32',
    fallback: 'C:\\fallback',
  });
  assert.equal(root, path.join('C:\\Users\\x\\AppData\\Local', 'DouyinAccountHub'));
});

test('非 Windows 走 fallback', () => {
  const root = resolveHubRoot({ env: { LOCALAPPDATA: '/ignored' }, platform: 'darwin', fallback: '/tmp/hub' });
  assert.equal(root, path.resolve('/tmp/hub'));
});

test('runtime 与 data 严格分离 —— 卸载要能一次删干净', () => {
  const paths = createHubPaths(path.join('C:\\', 'hub'));
  assert.equal(paths.runtimeRoot, path.join('C:\\', 'hub', 'runtime'));
  assert.equal(paths.dataRoot, path.join('C:\\', 'hub', 'data'));
  assert.ok(!paths.dataRoot.startsWith(paths.runtimeRoot));
  assert.ok(!paths.runtimeRoot.startsWith(paths.dataRoot));
});

test('profileDirOf 落在 data/profiles/<id> 下', () => {
  const paths = createHubPaths(path.join('C:\\', 'hub'));
  assert.equal(
    paths.profileDirOf('abc-123'),
    path.join('C:\\', 'hub', 'data', 'profiles', 'abc-123'),
  );
  assert.equal(paths.accountsFile, path.join('C:\\', 'hub', 'data', 'accounts.json'));
  assert.equal(paths.logFile, path.join('C:\\', 'hub', 'data', 'logs', 'app.log'));
});
