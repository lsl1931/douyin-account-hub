import fs from 'node:fs';
import path from 'node:path';

type Level = 'INFO' | 'WARN' | 'ERROR';

/**
 * 极简追加式日志。
 *
 * 不引日志库的理由：用户遇到问题时，我需要的是一条能贴给我的完整命令行和一条明确错误，
 * 而不是结构化字段。写文件和 stdout 双写，够用。
 */
export class Logger {
  constructor(private readonly file: string | null) {}

  info(message: string): void {
    this.write('INFO', message);
  }

  warn(message: string): void {
    this.write('WARN', message);
  }

  error(message: string): void {
    this.write('ERROR', message);
  }

  private write(level: Level, message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    if (level === 'ERROR') console.error(line);
    else console.log(line);

    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${line}\n`, 'utf8');
    } catch {
      // 日志写不进去绝不能反过来打断主流程
    }
  }
}
