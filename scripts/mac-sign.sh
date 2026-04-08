#!/bin/bash
#
# CC Viewer macOS Self-Signed Code Signing
#
# Usage:
#   ./scripts/mac-sign.sh              # 创建证书(如不存在) + 签名 app
#   ./scripts/mac-sign.sh --create     # 仅创建证书
#   ./scripts/mac-sign.sh --sign       # 仅签名(证书需已存在)
#   ./scripts/mac-sign.sh --verify     # 验证签名
#   ./scripts/mac-sign.sh --revoke     # 删除证书
#
# 证书有效期默认 7 天，可通过环境变量覆盖：
#   CERT_DAYS=30 ./scripts/mac-sign.sh
#

set -euo pipefail

CERT_NAME="${CERT_NAME:-CC Viewer Dev}"
CERT_DAYS="${CERT_DAYS:-365}"
APP_NAME="CC Viewer"
DIST_DIR="electron-dist"

# 自动检测 arch
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  APP_PATH="$DIST_DIR/mac-arm64/$APP_NAME.app"
else
  APP_PATH="$DIST_DIR/mac/$APP_NAME.app"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[info]${NC} $1"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $1"; }
error() { echo -e "${RED}[error]${NC} $1"; exit 1; }

# ── 检查证书是否存在 ──
cert_exists() {
  security find-identity -v -p codesigning 2>/dev/null | grep -q "$CERT_NAME"
}

# ── 创建自签名证书 ──
create_cert() {
  if cert_exists; then
    info "证书 '$CERT_NAME' 已存在，跳过创建"
    security find-identity -v -p codesigning | grep "$CERT_NAME"
    return 0
  fi

  info "创建自签名代码签名证书 '$CERT_NAME' (有效期 ${CERT_DAYS} 天)..."

  TMPDIR=$(mktemp -d)
  trap "rm -rf '$TMPDIR'" EXIT

  # 生成私钥
  openssl genrsa -out "$TMPDIR/key.pem" 2048 2>/dev/null

  # 证书配置 (包含 Code Signing 扩展)
  cat > "$TMPDIR/cert.cnf" << EOF
[req]
distinguished_name = req_dn
x509_extensions = codesign_ext
prompt = no

[req_dn]
CN = $CERT_NAME
O = CC Viewer Dev

[codesign_ext]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
EOF

  # 生成自签名证书
  openssl req -new -x509 -key "$TMPDIR/key.pem" -out "$TMPDIR/cert.pem" \
    -days "$CERT_DAYS" -config "$TMPDIR/cert.cnf" 2>/dev/null

  # 打包为 .p12
  openssl pkcs12 -export -inkey "$TMPDIR/key.pem" -in "$TMPDIR/cert.pem" \
    -out "$TMPDIR/cert.p12" -passout pass: 2>/dev/null

  # 导入到 login keychain
  security import "$TMPDIR/cert.p12" -k ~/Library/Keychains/login.keychain-db \
    -T /usr/bin/codesign -f pkcs12 -P "" 2>/dev/null

  # 设置 codesign 的分区访问 (避免每次签名弹密码框)
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
    -k "" ~/Library/Keychains/login.keychain-db 2>/dev/null || true

  info "证书已创建并导入 keychain"

  # 验证
  if cert_exists; then
    security find-identity -v -p codesigning | grep "$CERT_NAME"
    info "证书过期时间: $(openssl x509 -in "$TMPDIR/cert.pem" -noout -enddate 2>/dev/null | cut -d= -f2)"
  else
    error "证书导入失败，请尝试手动通过 钥匙串访问 创建"
  fi
}

# ── 签名 app ──
sign_app() {
  if [ ! -d "$APP_PATH" ]; then
    error "未找到 $APP_PATH，请先运行 npm run electron:build"
  fi

  if ! cert_exists; then
    error "证书 '$CERT_NAME' 不存在，请先运行: $0 --create"
  fi

  info "签名 $APP_PATH ..."

  # 先签名所有 framework / helper
  find "$APP_PATH" -name "*.framework" -o -name "*.dylib" -o -name "*.app" | while read -r item; do
    codesign -s "$CERT_NAME" --deep --force --timestamp=none "$item" 2>/dev/null || true
  done

  # 签名主 app
  codesign -s "$CERT_NAME" --deep --force --timestamp=none "$APP_PATH"

  info "签名完成"
}

# ── 验证签名 ──
verify_app() {
  if [ ! -d "$APP_PATH" ]; then
    error "未找到 $APP_PATH"
  fi

  info "验证签名..."
  codesign -v --deep --strict "$APP_PATH" 2>&1 && info "签名有效" || warn "签名无效"

  echo ""
  info "签名详情:"
  codesign -dvv "$APP_PATH" 2>&1 | grep -E "Authority|TeamIdentifier|Signature"
}

# ── 删除证书 ──
revoke_cert() {
  if ! cert_exists; then
    warn "证书 '$CERT_NAME' 不存在"
    return 0
  fi

  info "删除证书 '$CERT_NAME' ..."
  security delete-identity -c "$CERT_NAME" ~/Library/Keychains/login.keychain-db 2>/dev/null || true
  security delete-certificate -c "$CERT_NAME" ~/Library/Keychains/login.keychain-db 2>/dev/null || true

  if cert_exists; then
    warn "删除不完全，请手动在 钥匙串访问 中删除 '$CERT_NAME'"
  else
    info "证书已删除"
  fi
}

# ── 主入口 ──
case "${1:-}" in
  --create)  create_cert ;;
  --sign)    sign_app ;;
  --verify)  verify_app ;;
  --revoke)  revoke_cert ;;
  *)
    create_cert
    sign_app
    verify_app
    ;;
esac
