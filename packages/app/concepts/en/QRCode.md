# Mobile QR Code Access

## How It Works

CC Viewer starts an HTTP server on your machine and generates a **local network address** (e.g., `http://192.168.1.100:7008`). Scan the QR code with your phone to access Claude Code from your mobile device over the same WiFi network.

## Why Can't I Connect?

Common reasons:

1. **Not on the same network** — Your phone and computer must be connected to the same WiFi (same router / same network name)
2. **Firewall blocking** — macOS/Windows firewall may block incoming connections; allow CC Viewer's port
3. **Corporate/school network isolation** — Some enterprise networks isolate device-to-device communication (AP isolation)
4. **VPN interference** — A VPN on either device may disrupt the network path

## Security Notice

> ⚠️ CC Viewer's LAN service is accessible to all devices on the same network by default.

- Be cautious when using on **public WiFi** (cafes, airports) — others on the same network could potentially access your service
- CC Viewer uses **token-based authentication** for LAN access (token is embedded in the URL); requests without a valid token are rejected
- Recommended for use on trusted home or office networks

## Beyond the LAN

If you need remote access to Claude Code from a different network (e.g., when traveling):

- **Tunneling tools** — frp, ngrok, Tailscale, etc. to expose local services to the internet
- **CC Viewer plugins** — Configure a proxy middleware via the plugin system for cross-network access (see plugin docs)
