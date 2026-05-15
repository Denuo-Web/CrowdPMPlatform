#!/usr/bin/env python3
from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path

from crowdpm_node.portal import PortalServer
from crowdpm_node.service import NodeService
from crowdpm_node.settings import AppPaths, AppSettings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", default="/opt/crowdpm-node")
    parser.add_argument("--http-port", type=int, default=80)
    parser.add_argument("--hostname", default="crowdpm-node")
    args = parser.parse_args()

    settings = AppSettings(setup_http_port=args.http_port, hostname=args.hostname)
    paths = AppPaths(base_dir=Path(args.state_dir))
    service = NodeService(settings=settings, paths=paths)
    portal = PortalServer(service, host="0.0.0.0", port=settings.setup_http_port)

    def shutdown(_signum, _frame):
        portal.stop()
        service.stop()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    service.start()
    portal.start()
    while True:
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main())
