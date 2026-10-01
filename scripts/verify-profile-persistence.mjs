#!/usr/bin/env node
/**
 * 证明"每个账号一份独立 profile ⇒ 登录态跨浏览器重启保留"这条核心机制。
 *
 * 为什么需要它：真正的验收（扫码一次后免登录）必须有用户的抖音账号在场。
 * 但那条链路成立的**底层机制**是"Chrome 会把 cookie 持久化到 --user-data-dir"，
 * 这件事可以用一个本地 HTTP 服务 + 两次真实的 Chrome 启动独立证明，
 * 不需要任何抖音凭据。机制立不住，上层免登录就是空谈；机制立住了，
 * 上层的唯一变量就只剩抖音自己什么时候让 cookie 过期。
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CHROME_CANDIDATES = [
  path.join(process.env.ProgramFiles ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
];

const COOKIE_NAME = 'dyhub_persistence_probe';
const COOKIE_VALUE = `alive-${Date.now()}`;

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('找不到 chrome.exe');
}

/**
 * ⚠️ 必须用异步的 execFile，**不能**用 execFileSync。
 *
 * 本脚本的 HTTP 服务跑在同一个 Node 进程里。execFileSync 会阻塞事件循环，
 * 服务就永远没机会响应 Chrome 的请求，Chrome 于是一直等 → 表现为 spawnSync ETIMEDOUT。
 * 这个坑第一次就踩了，写在这里免得再踩。
 *
 * 另外两个已踩过的坑：
 *  - 不要加 --virtual-time-budget：它让 Chrome 等虚拟时间，反而不退出。
 *  - chrome.exe 是 GUI 子系统程序，PowerShell 的 `&` 不会等它，也拿不到 stdout。
 */
async function runChrome(chrome, profileDir, url) {
  const { stdout } = await execFileAsync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-default-apps',
      '--disable-extensions',
      '--no-service-autorun',
      `--user-data-dir=${profileDir}`,
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

async function main() {
  const chrome = findChrome();
  console.log(`[verify] chrome = ${chrome}`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyhub-persist-'));
  console.log(`[verify] profile = ${profileDir}`);

  const server = http.createServer((req, res) => {
    const headers = { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' };
    if (req.url === '/set') {
      res.writeHead(200, {
        ...headers,
        'Set-Cookie': `${COOKIE_NAME}=${COOKIE_VALUE}; Max-Age=86400; Path=/`,
      });
      res.end('<html><body>cookie-set</body></html>');
      return;
    }
    res.writeHead(200, headers);
    res.end('<html><body>seen: <script>document.write(document.cookie)</script></body></html>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log(`[verify] server = ${base}`);

  const failures = [];

  try {
    // 第一次启动：写入持久 cookie
    const first = await runChrome(chrome, profileDir, `${base}/set`);
    const firstOk = first.includes('cookie-set');
    console.log(`[verify] 第一次启动加载 /set：${firstOk ? '成功' : '失败'}`);
    if (!firstOk) failures.push('第一次启动未能加载 /set 页面');

    const cookieDb = path.join(profileDir, 'Default', 'Network', 'Cookies');
    if (fs.existsSync(cookieDb)) {
      console.log(`[verify] cookie 数据库已落盘：${cookieDb} (${fs.statSync(cookieDb).size} 字节)`);
    } else {
      failures.push(`profile 未生成 cookie 数据库：${cookieDb}`);
    }

    // 第二次启动：同一个 profile，全新进程
    const second = await runChrome(chrome, profileDir, `${base}/read`);
    const found = second.includes(COOKIE_VALUE);
    console.log(`[verify] 第二次启动（全新进程）读到 cookie：${found ? '是' : '否'}`);
    if (!found) failures.push('重启浏览器后 cookie 丢失 —— profile 没有真正持久化');

    // 反证：换一个全新 profile，必须读不到
    const otherProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'dyhub-persist-other-'));
    const third = await runChrome(chrome, otherProfile, `${base}/read`);
    const leaked = third.includes(COOKIE_VALUE);
    console.log(
      `[verify] 另一 profile 是否读到同一个 cookie：${leaked ? '是（隔离失效！）' : '否（隔离正常）'}`,
    );
    if (leaked) failures.push('不同 profile 之间发生了 cookie 串扰 —— 账号隔离不成立');
    fs.rmSync(otherProfile, { recursive: true, force: true });
  } finally {
    server.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error('[verify] FAILED');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log('[verify] PASSED：profile 持久化与账号隔离均已实证');
}

main().catch((err) => {
  console.error(`[verify] 异常：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
