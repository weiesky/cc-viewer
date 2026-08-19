#!/bin/bash

# 签名配置检查工具

echo "🔍 CC Viewer 签名配置检查"
echo "================================"
echo ""

# 检查证书
echo "1️⃣ 检查代码签名证书..."
IDENTITIES=$(security find-identity -v -p codesigning | grep "Developer ID Application")

if [ -z "$IDENTITIES" ]; then
  echo "   ❌ 未找到 Developer ID Application 证书"
  echo "   📖 请在 Apple Developer 账户中申请 Developer ID Application 证书"
  echo ""
else
  echo "   ✅ 找到证书:"
  echo "$IDENTITIES" | sed 's/^/      /'
  echo ""
fi

# 检查环境变量
echo "2️⃣ 检查环境变量配置..."
echo ""

check_env() {
  local var_name=$1
  local display_name=$2
  local is_required=$3

  if [ -n "${!var_name}" ]; then
    echo "   ✅ $display_name: 已设置"
  else
    if [ "$is_required" = "true" ]; then
      echo "   ❌ $display_name: 未设置 (必需)"
    else
      echo "   ⚠️  $display_name: 未设置 (可选，用于公证)"
    fi
  fi
}

echo "   签名配置:"
check_env "CSC_LINK" "CSC_LINK (证书路径)" "true"
check_env "CSC_KEY_PASSWORD" "CSC_KEY_PASSWORD (证书密码)" "true"

echo ""
echo "   公证配置:"
check_env "APPLE_ID" "APPLE_ID" "false"
check_env "APPLE_APP_SPECIFIC_PASSWORD" "APPLE_APP_SPECIFIC_PASSWORD" "false"
check_env "APPLE_TEAM_ID" "APPLE_TEAM_ID" "false"

echo ""

# 检查证书文件
if [ -n "$CSC_LINK" ]; then
  echo "3️⃣ 检查证书文件..."
  if [ -f "$CSC_LINK" ]; then
    echo "   ✅ 证书文件存在: $CSC_LINK"
  else
    echo "   ❌ 证书文件不存在: $CSC_LINK"
  fi
  echo ""
fi

# 总结
echo "================================"
echo ""

if [ -n "$IDENTITIES" ] && [ -n "$CSC_LINK" ] && [ -n "$CSC_KEY_PASSWORD" ]; then
  echo "✅ 签名配置完成！可以执行:"
  echo "   pnpm run electron:build  # 仅签名"

  if [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
    echo "   pnpm run electron:sign   # 签名 + 公证 (推荐)"
  else
    echo ""
    echo "⚠️  公证配置未完成，应用将仅签名"
    echo "   要启用公证，请设置 APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID"
  fi
else
  echo "❌ 配置未完成，请设置 CSC_LINK / CSC_KEY_PASSWORD 等环境变量后重试"
fi

echo ""
