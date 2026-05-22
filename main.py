"""
Legacy entrypoint (hand overlay only).

Prefer:
  python run.py demo      # setup + conduct with pitch/tempo control
  python run.py conduct   # conduct phase only
"""

import sys

from hackhcc.orchestrator import main

if __name__ == "__main__":
    sys.argv = [sys.argv[0], "conduct", *sys.argv[1:]]
    main()
