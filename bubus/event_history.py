from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterable, Iterator, MutableMapping
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Generic, TypeVar

from .models import BaseEvent, UUIDStr

if TYPE_CHECKING:
    from .models import EventResult
    from .service import EventBus

BaseEventT = TypeVar('BaseEventT', bound=BaseEvent[Any])


class EventHistory(MutableMapping[UUIDStr, BaseEventT], Generic[BaseEventT]):
    """Base class for storing EventBus history with filter support."""

    def add(self, event: BaseEventT) -> None:
        self[event.event_id] = event

    def contains(self, event_id: UUIDStr) -> bool:
        return event_id in self

    def count(self) -> int:
        return len(self)

    def iter_events(self) -> Iterable[BaseEventT]:
        return self.values()

    def iter_items(self) -> Iterable[tuple[UUIDStr, BaseEventT]]:
        return self.items()

    def filter(self, predicate: Callable[[BaseEventT], bool]) -> list[BaseEventT]:
        return [event for event in self.values() if predicate(event)]

    def copy(self) -> dict[UUIDStr, BaseEventT]:
        return dict(self.items())

    # Lifecycle hooks ----------------------------------------------------- #

    def record_event_snapshot(self, eventbus: EventBus, event: BaseEventT, phase: str | None = None) -> None:
        """Optional hook: persist or mirror a snapshot of the event lifecycle."""
        return None

    def record_event_result_snapshot(
        self,
        eventbus: EventBus,
        event: BaseEventT,
        event_result: EventResult[Any],
        phase: str | None = None,
    ) -> None:
        """Optional hook: persist or mirror a snapshot of an event result lifecycle."""
        return None


class InMemoryEventHistory(EventHistory[BaseEvent[Any]]):
    """Simple in-memory event history implementation."""

    def __init__(self) -> None:
        self._events: dict[UUIDStr, BaseEvent[Any]] = {}

    def __getitem__(self, key: UUIDStr) -> BaseEvent[Any]:
        return self._events[key]

    def __setitem__(self, key: UUIDStr, value: BaseEvent[Any]) -> None:
        self._events[key] = value

    def __delitem__(self, key: UUIDStr) -> None:
        del self._events[key]

    def __iter__(self) -> Iterator[UUIDStr]:
        return iter(self._events)

    def __len__(self) -> int:
        return len(self._events)

    def clear(self) -> None:
        self._events.clear()


class SQLiteEventHistory(EventHistory[BaseEvent[Any]]):
    """Event history backend that mirrors lifecycle snapshots into append-only SQLite tables."""

    def __init__(self, db_path: Path | str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self._events: dict[UUIDStr, BaseEvent[Any]] = {}
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False, isolation_level=None)
        self._init_db()

    def __del__(self):
        try:
            self._conn.close()
        except Exception:
            pass

    # MutableMapping implementation --------------------------------------- #
    def __getitem__(self, key: UUIDStr) -> BaseEvent[Any]:
        return self._events[key]

    def __setitem__(self, key: UUIDStr, value: BaseEvent[Any]) -> None:
        self._events[key] = value

    def __delitem__(self, key: UUIDStr) -> None:
        self._events.pop(key, None)

    def __iter__(self) -> Iterator[UUIDStr]:
        return iter(self._events)

    def __len__(self) -> int:
        return len(self._events)

    def clear(self) -> None:
        self._events.clear()

    # Internal helpers ---------------------------------------------------- #
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

    # Persistence hooks --------------------------------------------------- #
    def record_event_snapshot(
        self,
        eventbus: EventBus,
        event: BaseEvent[Any],
        phase: str | None = None,
    ) -> None:
        event_status = 'error' if any(result.status == 'error' for result in event.event_results.values()) else event.event_status
        event_json = event.model_dump_json()

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
                    event.event_id,
                    event.event_type,
                    event_status,
                    eventbus.id,
                    eventbus.name,
                    phase,
                    event_json,
                ),
            )
            self._conn.commit()

    def record_event_result_snapshot(
        self,
        eventbus: EventBus,
        event: BaseEvent[Any],
        event_result: EventResult[Any],
        phase: str | None = None,
    ) -> None:
        error_repr = repr(event_result.error) if event_result.error is not None else None
        result_repr: str | None = None
        if event_result.result is not None and event_result.error is None:
            try:
                result_repr = repr(event_result.result)
            except Exception:
                result_repr = '<unrepr-able>'

        # Avoid huge JSON blobs for unreadable result types by falling back to repr
        try:
            event_result_json = event_result.model_dump_json()
        except Exception:
            event_result_json = None

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
                    event_result.id,
                    event_result.event_id,
                    event_result.handler_id,
                    event_result.handler_name,
                    event_result.eventbus_id,
                    event_result.eventbus_name,
                    event.event_type,
                    event_result.status,
                    phase,
                    result_repr,
                    error_repr,
                    event_result_json,
                ),
            )
            self._conn.commit()
