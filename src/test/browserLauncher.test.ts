import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLaunchArgs } from '../main/browserLauncher';

const profileDir = 'C:\\Users\\x\\AppData\\Local\\DouyinAccountHub\\data\\profiles\\abc-123';
const url = 'https://creator.douyin.com/';

test('--user-data-dir 指向该账号专属 profile 目录', () => {
  const args = buildLaunchArgs({ profileDir, url });
  assert.equal(args[0], `--user-data-dir=${profileDir}`);
});

test('--profile-directory=Default 不会被吞掉', () => {
  const args = buildLaunchArgs({ profileDir, url });
  assert.ok(args.includes('--profile-directory=Default'));
  const withCustom = buildLaunchArgs({ profileDir, url, profileDirectory: 'Profile 1' });
  assert.ok(withCustom.includes('--profile-directory=Profile 1'));
});

test('抑制首启向导的三个 flag 都在', () => {
  const args = buildLaunchArgs({ profileDir, url });
  assert.ok(args.includes('--no-first-run'));
  assert.ok(args.includes('--no-default-browser-check'));
  assert.ok(args.includes('--disable-search-engine-choice-screen'));
});

test('URL 必须是最后一个参数', () => {
  const args = buildLaunchArgs({ profileDir, url });
  assert.equal(args[args.length - 1], url);
});

test('路径含中文与空格时原样保留 —— 参数以数组传递，不经 shell，不需手工加引号', () => {
  const tricky = 'C:\\Users\\张 三\\AppData\\Local\\DouyinAccountHub\\data\\profiles\\acc 001';
  const args = buildLaunchArgs({ profileDir: tricky, url });
  assert.equal(args[0], `--user-data-dir=${tricky}`);
  assert.ok(!args[0]?.includes('"'), '不得出现引号 —— 引号会被当成路径的一部分');
});

test('账号 id 不同则 user-data-dir 必然不同（登录态隔离的根基）', () => {
  const a = buildLaunchArgs({ profileDir: 'C:\\p\\a', url })[0];
  const b = buildLaunchArgs({ profileDir: 'C:\\p\\b', url })[0];
  assert.notEqual(a, b);
});
