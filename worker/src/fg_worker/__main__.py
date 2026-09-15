from __future__ import annotations

import argparse
import json
import platform
import sys

from .capabilities import detect_capabilities
from .client import WorkerClient
from .credentials import CredentialStoreUnavailable, load_token, save_token
from .queue_loop import WorkerLoop, default_operation_runner


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="fg-worker", description="FG Studio 本地媒体 Worker")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("capabilities", help="打印本机 GPU/FFmpeg 能力")
    pair = sub.add_parser("pair", help="使用画布显示的一次性配对码")
    pair.add_argument("--server", required=True, help="FG Studio 地址")
    pair.add_argument("--code", required=True, help="一次性配对码")
    pair.add_argument("--name", default=platform.node() or "本机 Worker")
    run = sub.add_parser("run", help="启动 Worker 轮询")
    run.add_argument("--server", required=True, help="FG Studio 地址")
    sub.add_parser("benchmark", help="打印能力并提示使用正式 benchmark 命令")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command in {"capabilities", "benchmark"}:
        print(json.dumps(detect_capabilities(), ensure_ascii=False, indent=2))
        return 0
    capabilities = detect_capabilities()
    if args.command == "pair":
        try:
            client = WorkerClient(args.server, token="pairing-not-used")
            result = client.register(args.code, capabilities, name=args.name, platform=platform.system().lower(), architecture=platform.machine().lower())
            token = result.get("token")
            if not isinstance(token, str) or not token:
                print("配对失败：服务端没有返回令牌", file=sys.stderr)
                return 2
            save_token(token)
            print(json.dumps({"workerId": result.get("workerId"), "paired": True}, ensure_ascii=False))
            return 0
        except CredentialStoreUnavailable as error:
            print(str(error), file=sys.stderr)
            return 3
        except Exception as error:
            print(f"配对失败：{error}", file=sys.stderr)
            return 2
    if args.command == "run":
        try:
            token = load_token()
            if not WorkerLoop.can_start(token):
                print("Worker 尚未配对，请先运行 fg-worker pair", file=sys.stderr)
                return 3
            WorkerLoop(WorkerClient(args.server, token), capabilities, runner=default_operation_runner).run_forever()
        except KeyboardInterrupt:
            return 0
        except Exception as error:
            print(f"Worker 启动失败：{error}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
