"""Reusable EventBus middleware helpers."""

from __future__ import annotations

import asyncio
import logging
import threading
from pathlib import Path
from typing import Any

from bubus.logging import log_eventbus_tree
from bubus.models import BaseEvent
from bubus.service import EventBus
from bubus.service import EventBusMiddleware as _EventBusMiddleware

__all__ = ['EventBusMiddleware', 'WALEventBusMiddleware', 'LoggerEventBusMiddleware']

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
