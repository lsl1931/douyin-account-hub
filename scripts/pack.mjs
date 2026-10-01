#!/usr/bin/env node
/**
 * 打包 Windows 安装包。
 *
 * 为什么不直接跑 `electron-builder`：
 *
 * 两个互相独立的坑，根因是同一个 —— **从 DSH 工作区目录里启动的可执行文件是被限制的**。
 *
 *  1. electron-builder 把 NSIS 解压到自己的缓存目录再运行 makensis。
 *     缓存若在工作区内，makensis 连输出文件都写不了（`Can't open output file`）。
 *  2. 生成卸载程序的方式是**运行**刚打出来的安装包。
 *     安装包若落在工作区内，这个运行同样失败（`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`）。
 *
 * 所以：构建产物一律生成在工作区之外，跑完之后只把成品拷回来。
 * 拷贝不受影响 —— 受限的是"执行"，不是"读写"。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveBuildOutput() {
  const localAppData = process.env.LOCALAPPDATA;
  const base =
    typeof localAppData === 'string' && localAppData.trim() !== ''
      ? path.join(localAppData, 'DouyinAccountHub-build')
      : path.join(os.tmpdir(), 'DouyinAccountHub-build');
  const out = path.join(base, 'release');

  // 这条断言是这个脚本存在的全部理由，绝不能删。
  if (out === projectRoot || out.startsWith(projectRoot + path.sep)) {
    throw new Error(
      `构建输出目录不能位于工作区内：${out}\n` +
        '工作区内启动的可执行文件会被限制，electron-builder 生成卸载程序的步骤必然失败。',
    );
  }
  return out;
}

function main() {
  const outDir = resolveBuildOutput();
  const releaseDir = path.join(projectRoot, 'release');

  console.log(`[pack] 构建输出目录（工作区外）：${outDir}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(releaseDir, { recursive: true });

  const cli = path.join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  if (!fs.existsSync(cli)) {
    throw new Error(`找不到 electron-builder CLI：${cli}\n先运行 npm install。`);
  }

  const result = spawnSync(
    process.execPath,
    [cli, '--win', '--x64', `--config.directories.output=${outDir}`],
    { cwd: projectRoot, stdio: 'inherit' },
  );

  if (result.status !== 0) {
    console.error(`[pack] electron-builder 失败，退出码 ${result.status}`);
    process.exit(result.status ?? 1);
  }

  const artifacts = fs.readdirSync(outDir).filter((n) => n.toLowerCase().endsWith('.exe'));
  if (artifacts.length === 0) {
    console.error(`[pack] 构建目录里没有 .exe：${outDir}`);
    process.exit(1);
  }

  for (const name of artifacts) {
    const from = path.join(outDir, name);
    const to = path.join(releaseDir, name);
    fs.copyFileSync(from, to);
    const mb = (fs.statSync(to).size / 1024 / 1024).toFixed(1);
    console.log(`[pack] ${name}  (${mb} MB)  ->  release/${name}`);
  }

  console.log('[pack] 完成。');
}

try {
  main();
} catch (err) {
  console.error(`[pack] 失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
