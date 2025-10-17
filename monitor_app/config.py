"""Configuration helpers for the monitoring app."""

from __future__ import annotations

import os
from pathlib import Path

DEFAULT_DB_PATH = Path(os.getenv('EVENT_HISTORY_DB', 'events.sqlite'))


def resolve_db_path() -> Path:
    """
    Resolve the path to the SQLite history database.

    The path can be overridden via the EVENT_HISTORY_DB environment variable.
    """
    db_path = Path(os.getenv('EVENT_HISTORY_DB', DEFAULT_DB_PATH))
    if not db_path.is_absolute():
        # Resolve relative to repository root (parent directory of monitor_app)
        db_path = Path(__file__).resolve().parent.parent / db_path
    return db_path
