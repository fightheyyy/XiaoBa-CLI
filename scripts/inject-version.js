const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');

function resolveVersion() {
  if (process.argv[2]) {
    return process.argv[2];
  }

  const ref = process.env.GITHUB_REF || '';
  const tagMatch = ref.match(/refs\/tags\/v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  if (tagMatch) {
    return tagMatch[1];
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    try {
      execSync('git fetch --tags', { cwd: rootDir, stdio: 'pipe' });
      const localTag = execSync('git describe --tags --abbrev=0', { cwd: rootDir })
        .toString()
        .trim()
        .replace(/^v/, '');
      if (localTag) {
        return localTag;
      }
    } catch {}
  }

  return require(path.join(rootDir, 'package.json')).version;
}

function updateJsonVersion(filePath, version) {
  const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  json.version = version;
  if (json.packages && json.packages['']) {
    json.packages[''].version = version;
  }
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n');
}

const version = resolveVersion();

console.log(`Injecting version: ${version}`);
updateJsonVersion(path.join(rootDir, 'package.json'), version);
updateJsonVersion(path.join(rootDir, 'package-lock.json'), version);
console.log('Updated package.json and package-lock.json');
