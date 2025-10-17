from __future__ import annotations

from collections.abc import Iterable, Iterator, MutableMapping
import sqlite3
import threading
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

    def get(self, event_id: UUIDStr, default: BaseEventT | None = None) -> BaseEventT | None:
        try:
            return self[event_id]
        except KeyError:
            return default

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
