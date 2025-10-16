"""Reusable EventBus middleware helpers."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

from bubus.logging import log_eventbus_tree
from bubus.models import BaseEvent
from bubus.service import EventBus, EventBusMiddleware as _EventBusMiddleware

__all__ = ['EventBusMiddleware', 'WALEventBusMiddleware', 'LoggerEventBusMiddleware', 'SQLiteEventBusMiddleware']

logger = logging.getLogger('bubus.middleware')

EventBusMiddleware = _EventBusMiddleware


class WALEventBusMiddleware(EventBusMiddleware):
    """Persist completed events to a JSONL write-ahead log."""

    def __init__(self, wal_path: Path | str):
        self.wal_path = Path(wal_path)
        self.wal_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    async def after_event(self, eventbus: EventBus, event: BaseEvent[Any]) -> None:
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

    async def after_event(self, eventbus: EventBus, event: BaseEvent[Any]) -> None:
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


class SQLiteEventBusMiddleware(EventBusMiddleware):
    """Mirror events and handler results into append-only SQLite tables."""

    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.execute('PRAGMA journal_mode=WAL')
        self._conn.execute('PRAGMA synchronous=NORMAL')
        self._setup_schema()
        self._lock = asyncio.Lock()

    def __del__(self):
        try:
            self._conn.close()
        except Exception:
            pass

    def _setup_schema(self) -> None:
        self._conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS events_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_status TEXT NOT NULL,
                eventbus_name TEXT,
                event_json TEXT NOT NULL,
                inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        self._conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS event_results_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL,
                handler_id TEXT NOT NULL,
                handler_name TEXT NOT NULL,
                eventbus_id TEXT NOT NULL,
                eventbus_name TEXT NOT NULL,
                status TEXT NOT NULL,
                result_repr TEXT,
                error_repr TEXT,
                inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        self._conn.commit()

    async def before_handler(self, eventbus: EventBus, event: BaseEvent[Any], event_result) -> None:
        await self._insert_event_result(event_result)

    async def after_handler(self, eventbus: EventBus, event: BaseEvent[Any], event_result) -> None:
        await self._insert_event_result(event_result)

    async def on_handler_error(
        self,
        eventbus: EventBus,
        event: BaseEvent[Any],
        event_result,
        error: BaseException,
    ) -> None:
        await self._insert_event_result(event_result, error_override=error)

    async def after_event(self, eventbus: EventBus, event: BaseEvent[Any]) -> None:
        if getattr(event, '_sqlite_logged', False):
            return

        if not self._event_is_complete(event):
            return

        await self._insert_event(eventbus, event)
        setattr(event, '_sqlite_logged', True)

    async def _insert_event_result(self, event_result, error_override: BaseException | None = None) -> None:
        error = error_override or event_result.error
        error_repr = repr(error) if error is not None else None
        result_repr = None
        if event_result.result is not None and error is None:
            try:
                result_repr = repr(event_result.result)
            except Exception:
                result_repr = '<unrepr-able>'

        await self._execute(
            '''
            INSERT INTO event_results_log (
                event_id,
                handler_id,
                handler_name,
                eventbus_id,
                eventbus_name,
                status,
                result_repr,
                error_repr
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                event_result.event_id,
                event_result.handler_id,
                event_result.handler_name,
                event_result.eventbus_id,
                event_result.eventbus_name,
                event_result.status,
                result_repr,
                error_repr,
            ),
        )

    async def _insert_event(self, eventbus: EventBus, event: BaseEvent[Any]) -> None:
        event_json = event.model_dump_json()  # pyright: ignore[reportUnknownMemberType]
        has_error = any(result.status == 'error' for result in event.event_results.values())
        event_status = 'error' if has_error else event.event_status

        await self._execute(
            '''
            INSERT INTO events_log (
                event_id,
                event_type,
                event_status,
                eventbus_name,
                event_json
            )
            VALUES (?, ?, ?, ?, ?)
            ''',
            (
                event.event_id,
                event.event_type,
                event_status,
                eventbus.name,
                event_json,
            ),
        )

    async def _execute(self, sql: str, params: tuple[Any, ...]) -> None:
        async with self._lock:
            await asyncio.to_thread(self._run_execute, sql, params)

    def _run_execute(self, sql: str, params: tuple[Any, ...]) -> None:
        self._conn.execute(sql, params)
        self._conn.commit()

    def _event_is_complete(self, event: BaseEvent[Any]) -> bool:
        signal = event.event_completed_signal
        if signal is not None and not signal.is_set():
            return False
        if any(result.status not in ('completed', 'error') for result in event.event_results.values()):
            return False
        return event.event_are_all_children_complete()
