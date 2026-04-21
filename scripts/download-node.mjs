#!/usr/bin/env node

/**
 * 下载 Windows 版 Node.js 可执行文件，用于 Electron 打包时内嵌
 * 用法: node scripts/download-node.mjs [version]
 * 默认版本: v20.18.1 (LTS)
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createUnzip } from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const NODE_VERSION = process.argv[2] || 'v20.18.1';
const OUTPUT_DIR = path.join(projectRoot, 'build-resources', 'node');
const NODE_EXE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} ...`);

    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const pct = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          process.stdout.write(`\r  Progress: ${pct}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('\n  Download complete!');
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  console.log(`=== Download Node.js ${NODE_VERSION} for Windows x64 ===\n`);

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const nodeExeDest = path.join(OUTPUT_DIR, 'node.exe');

  // Check if already downloaded
  if (fs.existsSync(nodeExeDest)) {
    const stats = fs.statSync(nodeExeDest);
    if (stats.size > 10 * 1024 * 1024) {
      console.log(`node.exe already exists (${(stats.size / 1024 / 1024).toFixed(1)} MB), skipping download.`);
      console.log(`Delete ${nodeExeDest} to force re-download.`);
      return;
    }
    console.log('Existing node.exe seems too small, re-downloading...');
  }

  await download(NODE_EXE_URL, nodeExeDest);

  const stats = fs.statSync(nodeExeDest);
  console.log(`\nnode.exe saved to: ${nodeExeDest}`);
  console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
  console.log('\nDone! The node.exe will be included in the Electron build via extraFiles.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
