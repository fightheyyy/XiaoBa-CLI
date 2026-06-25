#!/bin/bash

# 本地打包脚本
set -e

echo "🚀 开始本地构建和打包..."

# 检查是否有未提交的更改
if [[ -n $(git status -s) ]]; then
  echo "❌ 有未提交的更改，请先提交"
  exit 1
fi

# 获取当前版本
VERSION=$(node -p "require('./package.json').version")
echo "📦 当前版本: $VERSION"

# 构建和打包
echo "📦 开始构建和打包..."
npm run electron:build

echo "✅ 本地打包完成！版本 $VERSION"
echo "📦 产物目录: release/"
