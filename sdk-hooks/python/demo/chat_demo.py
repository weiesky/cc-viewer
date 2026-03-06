#!/usr/bin/env python3
"""
CC-Viewer SDK Demo - 与 Claude 对话并监控通信

这个 demo 展示如何:
1. 启用 CC-Viewer 监控
2. 与 Claude Agent SDK 进行对话
3. 在 CC-Viewer Web UI 中查看通信记录

使用方法:
    # 设置 API Key
    export ANTHROPIC_API_KEY=your-api-key

    # 运行 demo
    python chat_demo.py

    # 然后访问 http://localhost:7008 查看通信记录
"""

import asyncio
import os
import sys
from pathlib import Path

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from cc_viewer_sdk import enable_cc_viewer, disable_cc_viewer


async def chat_with_claude():
    """与 Claude 进行对话的示例。"""
    from claude_agent_sdk import query, ClaudeAgentOptions

    print("\n" + "=" * 60)
    print("开始与 Claude 对话...")
    print("=" * 60)

    # 配置选项
    options = ClaudeAgentOptions(
        max_turns=3,  # 限制对话轮数
    )

    # 对话历史
    conversations = [
        "你好！请用一句话介绍你自己。",
        "你能帮我做什么？",
        "请给我讲一个简短的笑话。",
    ]

    for i, prompt in enumerate(conversations, 1):
        print(f"\n[对话 {i}] 用户: {prompt}")
        print("-" * 40)

        response_text = []
        try:
            async for msg in query(prompt=prompt, options=options):
                if hasattr(msg, 'content'):
                    for block in msg.content:
                        if hasattr(block, 'text'):
                            response_text.append(block.text)
                        elif hasattr(block, 'thinking'):
                            print(f"  [思考中...]")
                elif hasattr(msg, 'subtype') and msg.subtype == 'result':
                    print(f"  [完成] 耗时: {msg.duration_ms}ms")

            print(f"[对话 {i}] Claude: {' '.join(response_text)[:200]}...")

        except Exception as e:
            print(f"  [错误] {e}")
            break

        # 短暂暂停
        await asyncio.sleep(1)


async def main():
    """主函数 - 启用监控并运行对话。"""
    print("=" * 60)
    print("CC-Viewer SDK Demo")
    print("=" * 60)

    # 检查 API Key (支持 Anthropic 或智谱)
    has_api_key = (
        os.environ.get("ANTHROPIC_API_KEY") or
        os.environ.get("ANTHROPIC_AUTH_TOKEN")
    )
    if not has_api_key:
        print("\n错误: 请设置 API Key 环境变量")
        print("  Anthropic: export ANTHROPIC_API_KEY=your-api-key")
        print("  智谱:      export ANTHROPIC_AUTH_TOKEN=your-token")
        sys.exit(1)

    # 检查 claude_agent_sdk 是否安装
    try:
        import claude_agent_sdk
    except ImportError:
        print("\n错误: 请安装 claude-agent-sdk")
        print("  pip install claude-agent-sdk")
        sys.exit(1)

    print("\n正在启用 CC-Viewer 监控...")

    # 启用 CC-Viewer
    ctx = enable_cc_viewer()

    print(f"✓ 监控已启用")
    print(f"  - 代理端口: {ctx.proxy_port}")
    print(f"  - 代理 URL: {ctx.proxy_url}")
    print(f"\n请访问 http://localhost:7008 查看通信记录")
    print("(如果页面没打开，请在新终端运行: ccv)")
    print()

    try:
        # 运行对话
        await chat_with_claude()

    finally:
        # 清理
        print("\n" + "=" * 60)
        print("对话结束")
        print("=" * 60)
        print("\n提示: 你可以继续访问 http://localhost:7008 查看通信记录")
        print("完成查看后，按 Ctrl+C 退出...")

        # 等待用户查看
        try:
            await asyncio.sleep(300)  # 等待 5 分钟
        except KeyboardInterrupt:
            pass

        print("\n正在关闭监控...")
        ctx.disable()
        print("再见！")


if __name__ == "__main__":
    asyncio.run(main())
