"""Reusable EventBus middleware helpers."""

from __future__ import annotations

import asyncio
import logging
import threading
import sqlite3
from pathlib import Path
from typing import Any

from bubus.logging import log_eventbus_tree
from bubus.models import BaseEvent, EventResult
from bubus.service import EventBus
from bubus.service import EventBusMiddleware as _EventBusMiddleware

__all__ = [
    'EventBusMiddleware',
    'WALEventBusMiddleware',
    'LoggerEventBusMiddleware',
    'SQLiteHistoryMirrorMiddleware',
]

logger = logging.getLogger('bubus.middleware')

EventBusMiddleware = _EventBusMiddleware


class WALEventBusMiddleware(EventBusMiddleware):
    """Persist completed events to a JSONL write-ahead log."""

    def __init__(self, wal_path: Path | str):
        self.wal_path = Path(wal_path)
        self.wal_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    async def post_event_completed(self, eventbus: EventBus, event: BaseEvent[Any]) -> None:
        if getattr(event, '_wal_written', False):
            return

        if not self._event_is_complete(event):
            return

        try:
            await asyncio.to_thread(self._write_event, event)
            setattr(event, '_wal_written', True)
        except Exception as exc:  # pragma: no cover - logging branch
            logger.error(
                '❌ %s Failed to save event %s to WAL file %s: %s %s',
                eventbus,
                event.event_id,
                self.wal_path,
                type(exc).__name__,
                exc,
            )

    def _event_is_complete(self, event: BaseEvent[Any]) -> bool:
        signal = event.event_completed_signal
        if signal is not None and not signal.is_set():
            return False
        if any(result.status not in ('completed', 'error') for result in event.event_results.values()):
            return False
        return event.event_are_all_children_complete()

    def _write_event(self, event: BaseEvent[Any]) -> None:
        event_json = event.model_dump_json()  # pyright: ignore[reportUnknownMemberType]
        with self._lock:
            with self.wal_path.open('a', encoding='utf-8') as fp:
                fp.write(event_json + '\n')


class LoggerEventBusMiddleware(EventBusMiddleware):
    """Log completed events using the existing logging helpers and optionally mirror to a text file."""

    def __init__(self, log_path: Path | str | None = None):
        self.log_path = Path(log_path) if log_path is not None else None
        if self.log_path is not None:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)

    async def post_event_completed(self, eventbus: EventBus, event: BaseEvent[Any]) -> None:
        if getattr(event, '_logger_middleware_logged', False):
            return

        if not self._event_is_complete(event):
            return

        setattr(event, '_logger_middleware_logged', True)

        summary = event.event_log_safe_summary()
        logger.info('✅ %s completed event %s', eventbus, summary)

        line = f'[{eventbus.name}] {summary}\n'
        await asyncio.to_thread(self._append_line, line)

        if logger.isEnabledFor(logging.DEBUG):
            log_eventbus_tree(eventbus)

    def _event_is_complete(self, event: BaseEvent[Any]) -> bool:
        signal = event.event_completed_signal
        if signal is not None and not signal.is_set():
            return False
        if any(result.status not in ('completed', 'error') for result in event.event_results.values()):
            return False
        return event.event_are_all_children_complete()

    def _append_line(self, line: str) -> None:
        if self.log_path is not None:
            with self.log_path.open('a', encoding='utf-8') as fp:
                fp.write(line)
        print(line.rstrip('\n'), flush=True)


class SQLiteHistoryMirrorMiddleware(EventBusMiddleware):
    """Mirror event and handler snapshots into append-only SQLite tables."""

    def __init__(self, db_path: Path | str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
        self._init_db()

    def __del__(self):
        try:
            self._conn.close()
        except Exception:
            pass

    async def post_event_snapshot_recorded(self, eventbus: EventBus, event: BaseEvent[Any], phase: str) -> None:
        event_status = (
            'error' if any(result.status == 'error' for result in event.event_results.values()) else event.event_status
        )
        event_json = event.model_dump_json()
        await asyncio.to_thread(
            self._insert_event_snapshot,
            eventbus,
            event.event_id,
            event.event_type,
            event_status,
            phase,
            event_json,
        )

    async def post_event_handler_snapshot_recorded(
        self,
        eventbus: EventBus,
        event: BaseEvent[Any],
        event_result: EventResult[Any],
        phase: str,
    ) -> None:
        error_repr = repr(event_result.error) if event_result.error is not None else None
        result_repr: str | None = None
        if event_result.result is not None and event_result.error is None:
            try:
                result_repr = repr(event_result.result)
            except Exception:
                result_repr = '<unrepr-able>'

        try:
            event_result_json = event_result.model_dump_json()
        except Exception:
            event_result_json = None

        await asyncio.to_thread(
            self._insert_event_result_snapshot,
            event_result.id,
            event_result.event_id,
            event_result.handler_id,
            event_result.handler_name,
            eventbus.id,
            eventbus.name,
            event.event_type,
            event_result.status,
            phase,
            result_repr,
            error_repr,
            event_result_json,
        )

    def _init_db(self) -> None:
        with self._lock:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS events_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    event_status TEXT NOT NULL,
                    eventbus_id TEXT NOT NULL,
                    eventbus_name TEXT NOT NULL,
                    phase TEXT,
                    event_json TEXT NOT NULL,
                    inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS event_results_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_result_id TEXT NOT NULL,
                    event_id TEXT NOT NULL,
                    handler_id TEXT NOT NULL,
                    handler_name TEXT NOT NULL,
                    eventbus_id TEXT NOT NULL,
                    eventbus_name TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    phase TEXT,
                    result_repr TEXT,
                    error_repr TEXT,
                    event_result_json TEXT,
                    inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            self._conn.execute('PRAGMA journal_mode=WAL')
            self._conn.execute('PRAGMA synchronous=NORMAL')

    def _insert_event_snapshot(
        self,
        eventbus: EventBus,
        event_id: str,
        event_type: str,
        event_status: str,
        phase: str | None,
        event_json: str,
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO events_log (
                    event_id,
                    event_type,
                    event_status,
                    eventbus_id,
                    eventbus_name,
                    phase,
                    event_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    event_type,
                    event_status,
                    eventbus.id,
                    eventbus.name,
                    phase,
                    event_json,
                ),
            )
            self._conn.commit()

    def _insert_event_result_snapshot(
        self,
        event_result_id: str,
        event_id: str,
        handler_id: str,
        handler_name: str,
        eventbus_id: str,
        eventbus_name: str,
        event_type: str,
        status: str,
        phase: str | None,
        result_repr: str | None,
        error_repr: str | None,
        event_result_json: str | None,
    ) -> None:
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO event_results_log (
                    event_result_id,
                    event_id,
                    handler_id,
                    handler_name,
                    eventbus_id,
                    eventbus_name,
                    event_type,
                    status,
                    phase,
                    result_repr,
                    error_repr,
                    event_result_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_result_id,
                    event_id,
                    handler_id,
                    handler_name,
                    eventbus_id,
                    eventbus_name,
                    event_type,
                    status,
                    phase,
                    result_repr,
                    error_repr,
                    event_result_json,
                ),
            )
            self._conn.commit()
