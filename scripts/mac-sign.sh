#!/bin/bash

# macOS 应用签名和公证脚本
# 使用前请先运行 scripts/check-sign-config.sh 检查证书与环境变量配置

set -e

echo "🔐 macOS 应用签名和公证流程"
echo "================================"
echo ""

# 检查必需的环境变量
if [ -z "$CSC_LINK" ]; then
  echo "❌ 错误: 缺少 CSC_LINK 环境变量"
  echo "   请设置为你的 .p12 证书文件路径"
  exit 1
fi

if [ -z "$CSC_KEY_PASSWORD" ]; then
  echo "❌ 错误: 缺少 CSC_KEY_PASSWORD 环境变量"
  echo "   请设置为你的 .p12 证书密码"
  exit 1
fi

echo "✅ 证书配置检查通过"
echo ""

# 可选：公证配置检查
if [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
  echo "✅ 公证配置检查通过"
  echo "   应用将在签名后自动公证"
else
  echo "⚠️  未配置公证参数，将仅签名不公证"
  echo "   如需公证，请设置: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID"
fi

echo ""
echo "📦 开始构建和签名..."
echo ""

# 执行构建
pnpm run build && electron-builder --mac

echo ""
echo "✅ 完成！"
echo ""
echo "输出目录: apps/electron/electron-dist/"
