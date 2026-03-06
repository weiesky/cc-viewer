#!/usr/bin/env python3
"""
CC-Viewer SDK Demo - 远程监控模式

这个 demo 展示如何启用远程监控，让开发者可以从内网其他机器访问 CC-Viewer。

使用场景:
- 用户的 SDK 应用运行在服务器 A
- 开发者从电脑 B 通过浏览器访问 http://服务器A的IP:7008 查看日志

使用方法:
    # 在服务器上运行
    export ANTHROPIC_API_KEY=your-api-key
    python remote_demo.py

    # 开发者从其他机器访问
    # http://<服务器IP>:7008
"""

import asyncio
import os
import socket
import sys
from pathlib import Path

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from cc_viewer_sdk import enable_cc_viewer


def get_local_ip():
    """获取本机 IP 地址。"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


async def main():
    """主函数 - 启用远程监控。"""
    print("=" * 60)
    print("CC-Viewer 远程监控 Demo")
    print("=" * 60)

    # 检查 API Key
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("\n错误: 请设置 ANTHROPIC_API_KEY 环境变量")
        print("  export ANTHROPIC_API_KEY=your-api-key")
        sys.exit(1)

    # 获取本机 IP
    local_ip = get_local_ip()
    print(f"\n本机 IP: {local_ip}")

    # 启用远程监控
    print("\n正在启用 CC-Viewer 远程监控...")
    ctx = enable_cc_viewer(remote=True)

    print(f"✓ 远程监控已启用")
    print(f"  - 代理端口: {ctx.proxy_port}")
    print(f"  - 监听地址: 0.0.0.0:{ctx.proxy_port}")
    print()
    print("=" * 60)
    print("访问地址 (从内网其他机器):")
    print(f"  http://{local_ip}:7008")
    print("=" * 60)
    print()
    print("现在你可以运行你的 SDK 应用了。")
    print("所有请求都会被记录并可以在上述地址查看。")
    print()
    print("按 Ctrl+C 停止监控...")

    try:
        # 保持运行，等待用户查看
        while True:
            await asyncio.sleep(3600)  # 每小时检查一次
    except KeyboardInterrupt:
        print("\n正在关闭监控...")
        ctx.disable()
        print("再见！")


if __name__ == "__main__":
    asyncio.run(main())
