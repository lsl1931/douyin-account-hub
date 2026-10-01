import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.join(__dirname, '..', '..');

/** 这些后缀的文件会被按 ANSI 代码页解码的工具读取，非 ASCII 内容会变成乱码字节。 */
const ANSI_CONSUMED = ['.cmd', '.bat', '.ps1', '.nsh'];

/**
 * 这条测试是被两次真实事故逼出来的。
 *
 * cmd.exe 按系统 ANSI 代码页读取 .cmd 文件。仓库里的 .cmd 若含中文（**包括 rem 注释**），
 * 在中文 Windows 上会被解码成乱码字节，其中混进的 `&` `>` `"` 等字符足以让解析崩掉。
 *
 * 实际后果：
 *  - 生成的 uninstall.cmd 静默失效，点了卸载什么都不删；
 *  - start.cmd 把注释当命令执行，报出一个与真实原因毫无关系的错误。
 *
 * 两次都发生在"注释"上，因为注释看起来无害。所以用测试钉死，而不是靠记性。
 * 同样的道理适用于 .ps1（Windows PowerShell 5.1 无 BOM 时按 ANSI 解码）
 * 和 NSIS 的 .nsh。
 */
test('被 ANSI 解码的脚本文件必须全 ASCII（含注释）', () => {
  const offenders: string[] = [];
  const scanned: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'release') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      const lower = entry.name.toLowerCase();
      const ext = ANSI_CONSUMED.find((e) => lower.endsWith(e));
      if (!ext) continue;

      scanned.push(path.relative(projectRoot, full));
      const bytes = fs.readFileSync(full);
      for (let i = 0; i < bytes.length; i += 1) {
        const byte = bytes[i];
        if (byte !== undefined && byte > 0x7f) {
          offenders.push(
            `${path.relative(projectRoot, full)}: 偏移 ${i} 处出现非 ASCII 字节 0x${byte
              .toString(16)
              .toUpperCase()}`,
          );
          break;
        }
      }
    }
  };

  walk(projectRoot, 0);

  assert.ok(
    scanned.length >= 4,
    `只扫描到 ${scanned.length} 个文件（${scanned.join(', ')}）—— 说明测试找错了目录或后缀`,
  );
  assert.deepEqual(
    offenders,
    [],
    `以下文件含非 ASCII，被 ANSI 解码时会乱码：\n${offenders.join('\n')}`,
  );
});
