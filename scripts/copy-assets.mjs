// 把渲染层静态资源和图标拷进 dist/。
// 之所以需要这一步：tsc 只处理 .ts，HTML/CSS/ICO 得自己搬。
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const jobs = [
  {
    from: join(projectRoot, 'src', 'renderer', 'index.html'),
    to: join(projectRoot, 'dist', 'renderer', 'index.html'),
  },
  {
    from: join(projectRoot, 'src', 'renderer', 'styles.css'),
    to: join(projectRoot, 'dist', 'renderer', 'styles.css'),
  },
  {
    // 图标放进 dist/，这样开发态和安装版的相对位置一致：
    // 主进程里 `path.join(__dirname, '..', 'icon.ico')` 两边都能命中。
    from: join(projectRoot, 'build', 'icon.ico'),
    to: join(projectRoot, 'dist', 'icon.ico'),
  },
];

for (const { from, to } of jobs) {
  if (!existsSync(from)) {
    console.error(`[copy-assets] MISSING: ${from}`);
    if (from.includes('icon.ico')) {
      console.error('[copy-assets] 图标未生成，先运行：npm run icon');
    }
    process.exit(1);
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`[copy-assets] ${from.slice(projectRoot.length + 1)} -> ${to.slice(projectRoot.length + 1)}`);
}
