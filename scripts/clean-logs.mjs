#!/usr/bin/env node
/**
 * 清理旧日志
 */
import fs from 'fs';
import path from 'path';

const RUNTIME_LOG_DIR = 'logs';

console.log('🧹 清理旧日志\n');

let deletedCount = 0;
let totalSize = 0;

// 清理 legacy runtime logs (logs/YYYY-MM-DD/*.log)。当前 session trace 主线是 logs/sessions/**/*.jsonl。
console.log('1️⃣ 清理 legacy runtime .log...');
if (fs.existsSync(RUNTIME_LOG_DIR)) {
  const entries = fs.readdirSync(RUNTIME_LOG_DIR);

  for (const entry of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;

    const dirPath = path.join(RUNTIME_LOG_DIR, entry);
    const stat = fs.statSync(dirPath);

    if (stat.isDirectory()) {
      for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith('.log')) continue;
        const filePath = path.join(dirPath, file);
        const size = fs.statSync(filePath).size;
        fs.rmSync(filePath);
        deletedCount++;
        totalSize += size;
        console.log(`   🗑️  删除: ${entry}/${file} (${formatSize(size)})`);
      }
      if (fs.readdirSync(dirPath).length === 0) {
        fs.rmdirSync(dirPath);
      }
    }
  }
}

// 清理空的 legacy 日期目录。
if (fs.existsSync(RUNTIME_LOG_DIR)) {
  for (const entry of fs.readdirSync(RUNTIME_LOG_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
    const dirPath = path.join(RUNTIME_LOG_DIR, entry);
    if (fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
      deletedCount++;
    }
  }
}

console.log(`\n✅ 清理完成: 删除 ${deletedCount} 个 legacy 项，释放 ${formatSize(totalSize)}`);

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
