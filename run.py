#!/usr/bin/env python3
"""
Optional utilities. Main workflow:

  python 1_setup.py
  python 2_conduct.py
"""

from hackhcc.env import load_project_env

load_project_env()

from hackhcc.orchestrator import main

if __name__ == "__main__":
    main()
