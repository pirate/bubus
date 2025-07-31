from __future__ import annotations

import asyncio
import inspect
import logging
import os
from collections.abc import Awaitable, Callable, Generator
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any, Literal, Protocol, Self, TypeAlias, TypeVar, runtime_checkable
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PrivateAttr, model_validator
from uuid_extensions import uuid7str

if TYPE_CHECKING:
    from bubus.service import EventBus


logger = logging.getLogger('bubus')

BUBUS_LOG_LEVEL = os.getenv('BUBUS_LOG_LEVEL', 'WARNING')  # WARNING normally, otherwise DEBUG when testing
LIBRARY_VERSION = os.getenv('LIBRARY_VERSION', '1.0.0')

logger.setLevel(BUBUS_LOG_LEVEL)


def validate_event_name(s: str) -> str:
    assert str(s).isidentifier() and not str(s).startswith('_'), f'Invalid event name: {s}'
    return str(s)


def validate_python_id_str(s: str) -> str:
    assert str(s).replace('.', '').isdigit(), f'Invalid Python ID: {s}'
    return str(s)


def validate_uuid_str(s: str) -> str:
    uuid = UUID(str(s))
    return str(uuid)


UUIDStr: TypeAlias = Annotated[str, AfterValidator(validate_uuid_str)]
PythonIdStr: TypeAlias = Annotated[str, AfterValidator(validate_python_id_str)]
PythonIdentifierStr: TypeAlias = Annotated[str, AfterValidator(validate_event_name)]
# TypeVar for BaseEvent and its subclasses
# We use contravariant=True because if a handler accepts BaseEvent,
# it can also handle any subclass of BaseEvent
T_Event = TypeVar('T_Event', bound='BaseEvent', contravariant=True)

# For protocols with __func__ attributes, we need an invariant TypeVar
T_EventInvariant = TypeVar('T_EventInvariant', bound='BaseEvent')

# For handlers, we need to be flexible about the signature since:
# 1. Functions take just the event: handler(event)
# 2. Methods take self + event: handler(self, event)
# 3. Classmethods take cls + event: handler(cls, event)
# 4. Handlers can accept BaseEvent subclasses (contravariance)
#
# Python's type system doesn't handle this well, so we define specific protocols


@runtime_checkable
class EventHandlerFunc(Protocol[T_Event]):
    """Protocol for sync event handler functions"""

    def __call__(self, event: T_Event, /) -> Any: ...


@runtime_checkable
class AsyncEventHandlerFunc(Protocol[T_Event]):
    """Protocol for async event handler functions"""

    async def __call__(self, event: T_Event, /) -> Any: ...


@runtime_checkable
class EventHandlerMethod(Protocol[T_Event]):
    """Protocol for instance method event handlers"""

    def __call__(self, self_: Any, event: T_Event, /) -> Any: ...

    __self__: Any
    __name__: str


@runtime_checkable
class AsyncEventHandlerMethod(Protocol[T_Event]):
    """Protocol for async instance method event handlers"""

    async def __call__(self, self_: Any, event: T_Event, /) -> Any: ...

    __self__: Any
    __name__: str


@runtime_checkable
class EventHandlerClassMethod(Protocol[T_EventInvariant]):
    """Protocol for class method event handlers"""

    def __call__(self, cls: type[Any], event: T_EventInvariant, /) -> Any: ...

    __self__: type[Any]
    __name__: str
    __func__: Callable[[type[Any], T_EventInvariant], Any]


@runtime_checkable
class AsyncEventHandlerClassMethod(Protocol[T_EventInvariant]):
    """Protocol for async class method event handlers"""

    async def __call__(self, cls: type[Any], event: T_EventInvariant, /) -> Any: ...

    __self__: type[Any]
    __name__: str
    __func__: Callable[[type[Any], T_EventInvariant], Awaitable[Any]]


# Event handlers can be sync/async functions, methods, class methods, or coroutines
# The protocols are parameterized with BaseEvent but due to contravariance,
# they also accept handlers that take any BaseEvent subclass
EventHandler: TypeAlias = (
    EventHandlerFunc['BaseEvent']
    | AsyncEventHandlerFunc['BaseEvent']
    | EventHandlerMethod['BaseEvent']
    | AsyncEventHandlerMethod['BaseEvent']
    | EventHandlerClassMethod['BaseEvent']
    | AsyncEventHandlerClassMethod['BaseEvent']
    # | Callable[['BaseEvent'], Any]  # Simple sync callable
    # | Callable[['BaseEvent'], Awaitable[Any]]  # Simple async callable
    # | Coroutine[Any, Any, Any]  # Direct coroutine
)

# ContravariantEventHandler is needed to allow handlers to accept any BaseEvent subclass in some signatures
ContravariantEventHandler: TypeAlias = (
    EventHandlerFunc[T_Event]  # cannot be BaseEvent or type checker will complain
    | AsyncEventHandlerFunc['BaseEvent']
    | EventHandlerMethod['BaseEvent']
    | AsyncEventHandlerMethod[T_Event]  # cannot be 'BaseEvent' or type checker will complain
    | EventHandlerClassMethod['BaseEvent']
    | AsyncEventHandlerClassMethod['BaseEvent']
)


def get_handler_name(handler: ContravariantEventHandler[T_Event]) -> str:
    assert hasattr(handler, '__name__'), f'Handler {handler} has no __name__ attribute!'
    if inspect.ismethod(handler):
        return f'{handler.__self__}.{handler.__name__}'
    elif callable(handler):
        return f'{handler.__module__}.{handler.__name__}'  # type: ignore
    else:
        raise ValueError(f'Invalid handler: {handler} {type(handler)}, expected a function, coroutine, or method')


def get_handler_id(handler: EventHandler, eventbus: EventBus | None = None) -> str:
    """Generate a unique handler ID based on the bus and handler instance."""
    if eventbus is None:
        return str(id(handler))
    return f'{id(eventbus)}.{id(handler)}'


class BaseEvent(BaseModel):
    """
    The base model used for all Events that flow through the EventBus system.
    """

    model_config = ConfigDict(
        extra='allow',
        arbitrary_types_allowed=True,
        validate_assignment=True,
        validate_default=True,
        revalidate_instances='always',
    )

    event_type: PythonIdentifierStr = Field(default='UndefinedEvent', description='Event type name', max_length=64)
    event_schema: str = Field(
        default=f'UndefinedEvent@{LIBRARY_VERSION}',
        description='Event schema version in format ClassName@version',
        max_length=250,
    )  # long because it can include long function names / module paths
    event_timeout: float | None = Field(default=300.0, description='Timeout in seconds for event to finish processing')

    # Runtime metadata
    event_id: UUIDStr = Field(default_factory=uuid7str, max_length=36)
    event_path: list[PythonIdentifierStr] = Field(default_factory=list, description='Path tracking for event routing')
    event_parent_id: UUIDStr | None = Field(
        default=None, description='ID of the parent event that triggered this event', max_length=36
    )

    # Completion tracking fields
    event_created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description='Timestamp when event was first dispatched to an EventBus aka marked pending',
    )
    event_processed_at: datetime | None = Field(
        default=None,
        description='Timestamp when event was first processed by any handler',
    )

    event_results: dict[PythonIdStr, EventResult] = Field(
        default_factory=dict, exclude=True
    )  # Results indexed by str(id(handler_func))

    # Completion signal
    _event_completed_signal: asyncio.Event | None = PrivateAttr(default=None)

    def __hash__(self) -> int:
        """Make events hashable using their unique event_id"""
        return hash(self.event_id)

    def __str__(self) -> str:
        """BaseEvent#ab12⏳"""
        icon = (
            '⏳'
            if self.event_status == 'pending'
            else '✅'
            if self.event_status == 'completed'
            else '❌'
            if self.event_status == 'error'
            else '🏃'
        )
        # AuthBus≫DataBus▶ AuthLoginEvent#ab12 ⏳
        return f'{"≫".join(self.event_path[1:] or "?")}▶ {self.event_type}#{self.event_id[-4:]} {icon}'

    def __await__(self) -> Generator[Self, Any, Any]:
        """Wait for event to complete and return self"""

        # long descriptive name here really helps make traceback easier to follow
        async def wait_for_handlers_to_complete_then_return_event():
            assert self.event_completed_signal is not None

            # If we're inside a handler and this event isn't complete yet,
            # we need to process it immediately to avoid deadlock
            from bubus.service import EventBus, holds_global_lock, inside_handler_context

            if not self.event_completed_signal.is_set() and inside_handler_context.get() and holds_global_lock.get():
                # We're inside a handler and hold the global lock
                # Process events until this one completes

                logger.debug(f'__await__ for {self} - inside handler context, processing child events')

                # Keep processing events from all buses until this event is complete
                max_iterations = 1000  # Prevent infinite loops
                iterations = 0

                while not self.event_completed_signal.is_set() and iterations < max_iterations:
                    iterations += 1
                    processed_any = False

                    # Process any queued events on all buses
                    for bus in EventBus.all_instances:
                        if not bus or not bus.event_queue:
                            continue

                        # Process one event from this bus if available
                        try:
                            if bus.event_queue.qsize() > 0:
                                event = bus.event_queue.get_nowait()
                                await bus.process_event(event)
                                bus.event_queue.task_done()
                                processed_any = True
                        except asyncio.QueueEmpty:
                            pass

                    if not processed_any:
                        # No events to process, yield control
                        await asyncio.sleep(0)

                if iterations >= max_iterations:
                    logger.error(f'Max iterations reached while waiting for {self}')

            try:
                await asyncio.wait_for(self.event_completed_signal.wait(), timeout=self.event_timeout)
            except TimeoutError:
                raise RuntimeError(
                    f'{self} waiting for results timed out after {self.event_timeout}s (being processed by {len(self.event_results)} handlers)'
                )

            return self

        return wait_for_handlers_to_complete_then_return_event().__await__()

    @model_validator(mode='before')
    @classmethod
    def _set_event_type_from_class_name(cls, data: dict[str, Any]) -> dict[str, Any]:
        """Automatically set event_type to the class name if not provided"""
        is_class_default_unchanged = cls.model_fields['event_type'].default == 'UndefinedEvent'
        is_event_type_not_provided = 'event_type' not in data or data['event_type'] == 'UndefinedEvent'
        if is_class_default_unchanged and is_event_type_not_provided:
            data['event_type'] = cls.__name__
        return data

    @model_validator(mode='before')
    @classmethod
    def _set_event_schema_from_class_name(cls, data: dict[str, Any]) -> dict[str, Any]:
        """Append the library version number to the event schema so we know what version was used to create any JSON dump"""
        is_class_default_unchanged = cls.model_fields['event_schema'].default == f'UndefinedEvent@{LIBRARY_VERSION}'
        is_event_schema_not_provided = 'event_schema' not in data or data['event_schema'] == f'UndefinedEvent@{LIBRARY_VERSION}'
        if is_class_default_unchanged and is_event_schema_not_provided:
            data['event_schema'] = f'{cls.__module__}.{cls.__qualname__}@{LIBRARY_VERSION}'
        return data

    @property
    def event_completed_signal(self) -> asyncio.Event | None:
        """Lazily create asyncio.Event when accessed"""
        if self._event_completed_signal is None:
            try:
                asyncio.get_running_loop()
                self._event_completed_signal = asyncio.Event()
            except RuntimeError:
                pass  # Keep it None if no event loop
        return self._event_completed_signal

    @property
    def event_status(self) -> str:
        return 'completed' if self.event_completed_at else 'started' if self.event_started_at else 'pending'

    @property
    def event_children(self) -> list[BaseEvent]:
        """Get all child events dispatched from within this event's handlers"""
        children: list[BaseEvent] = []
        for event_result in self.event_results.values():
            children.extend(event_result.event_children)
        return children

    @property
    def event_started_at(self) -> datetime | None:
        """Timestamp when event first started being processed by any handler"""
        started_times = [result.started_at for result in self.event_results.values() if result.started_at is not None]
        # If no handlers but event was processed, use the processed timestamp
        if not started_times and self.event_processed_at:
            return self.event_processed_at
        return min(started_times) if started_times else None

    @property
    def event_completed_at(self) -> datetime | None:
        """Timestamp when event was completed by all handlers"""
        # If no handlers at all but event was processed, use the processed timestamp
        if not self.event_results and self.event_processed_at:
            return self.event_processed_at

        # All handlers must be done (completed or error)
        all_done = all(result.status in ('completed', 'error') for result in self.event_results.values())
        if not all_done:
            return None

        # Return the latest completion time
        completed_times = [result.completed_at for result in self.event_results.values() if result.completed_at is not None]
        return max(completed_times) if completed_times else self.event_processed_at

    async def event_result(self, timeout: float | None = None) -> Any:
        """Get the first non-None result from the event handlers"""
        results = await self.event_results_list(timeout=timeout)
        results = list(filter(lambda r: r is not None, results))
        return results[0] if results else None

    async def event_results_by_handler_id(self, timeout: float | None = None) -> dict[PythonIdStr, Any]:
        """Get all raw result values organized by handler id {handler1_id: handler1_result, handler2_id: handler2_result, ...}"""
        assert self.event_completed_signal is not None, 'EventResult cannot be awaited outside of an async context'

        await asyncio.wait_for(self.event_completed_signal.wait(), timeout=timeout or self.event_timeout)

        return {handler_id: (await event_result) for handler_id, event_result in self.event_results.items()}

    async def event_results_by_handler_name(self, timeout: float | None = None) -> dict[PythonIdentifierStr, Any]:
        """Get all raw result values organized by handler name {handler1_name: handler1_result, handler2_name: handler2_result, ...}"""
        assert self.event_completed_signal is not None, 'EventResult cannot be awaited outside of an async context'

        await asyncio.wait_for(self.event_completed_signal.wait(), timeout=timeout or self.event_timeout)

        return {event_result.handler_name: (await event_result) for event_result in self.event_results.values()}

    async def event_results_list(self, timeout: float | None = None) -> list[Any]:
        """Get all result values in a list [handler1_result, handler2_result, ...]"""
        assert self.event_completed_signal is not None, 'EventResult cannot be awaited outside of an async context'

        await asyncio.wait_for(self.event_completed_signal.wait(), timeout=timeout or self.event_timeout)

        return [(await event_result) for event_result in self.event_results.values()]

    async def event_results_flat_dict(self, timeout: float | None = None) -> dict[Any, Any]:
        """Assuming all handlers return dicts, merge all the returned dicts into a single flat dict {**handler1_result, **handler2_result, ...}"""
        assert self.event_completed_signal is not None, 'EventResult cannot be awaited outside of an async context'

        await asyncio.wait_for(self.event_completed_signal.wait(), timeout=timeout or self.event_timeout)

        merged_results: dict[Any, Any] = {}
        for event_result in self.event_results.values():
            if event_result.status != 'completed' or not event_result.result:  # omit if result is pending, {}, or None
                continue
            if isinstance(event_result.result, BaseEvent):
                # this is returned by EventBus.dispatch() to allow for event forwarding,
                # handlers on other buses will automatically insert their own results into the event_results dict
                continue
            if not isinstance(event_result.result, dict):  # omit if result is not a dict
                logger.warning(
                    f'⚠️ {self}.event_results_flat_dict() expects all handlers to return a dict, but handler {event_result.handler_name}() returned a {type(event_result.result).__name__}: {repr(event_result.result)[:12]}...'
                )
                continue
            merged_results.update(
                event_result.result  # pyright: ignore[reportUnknownArgumentType, reportUnknownMemberType]
            )  # update the merged dict with the contents of the result dict
        return merged_results

    async def event_results_flat_list(self, timeout: float | None = None) -> list[Any]:
        """Assuming all handlers return lists, merge all the returned lists into a single flat list [*handler1_result, *handler2_result, ...]"""
        assert self.event_completed_signal is not None, 'EventResult cannot be awaited outside of an async context'

        await asyncio.wait_for(self.event_completed_signal.wait(), timeout=timeout or self.event_timeout)

        merged_results: list[Any] = []
        for event_result in self.event_results.values():
            if event_result.status != 'completed' or not event_result.result:  # omit if result is pending, {}, or None
                continue
            if isinstance(event_result.result, BaseEvent):
                # this is returned by EventBus.dispatch() to allow for event forwarding,
                # handlers on other buses will automatically insert their own results into the event_results dict
                continue
            if not isinstance(event_result.result, list):  # omit if result is not a list
                logger.warning(
                    f'⚠️ {self}.event_results_flat_list() expects all handlers to return a list, but handler {event_result.handler_name}() returned a {type(event_result.result).__name__}: {repr(event_result.result)[:12]}...'
                )
                continue
            merged_results.extend(
                event_result.result  # pyright: ignore[reportUnknownArgumentType, reportUnknownMemberType]
            )  # append the contents of the list to the merged list
        return merged_results

    def event_result_update(self, handler: EventHandler, eventbus: EventBus | None = None, **kwargs: Any) -> EventResult:
        """Create or update an EventResult for a handler"""

        from bubus.service import EventBus

        assert eventbus is None or isinstance(eventbus, EventBus)
        if eventbus is None and handler and inspect.ismethod(handler) and isinstance(handler.__self__, EventBus):
            eventbus = handler.__self__

        handler_name: str = get_handler_name(handler) if handler else 'unknown_handler'
        eventbus_id: PythonIdStr = str(id(eventbus) if eventbus is not None else '000000000000')
        eventbus_name: PythonIdentifierStr = str(eventbus and eventbus.name or 'EventBus')

        # Use bus+handler combination for unique ID
        handler_id: PythonIdStr = get_handler_id(handler, eventbus)

        # Get or create EventResult
        if handler_id not in self.event_results:
            self.event_results[handler_id] = EventResult(
                event_id=self.event_id,
                handler_id=handler_id,
                handler_name=handler_name,
                eventbus_id=eventbus_id,
                eventbus_name=eventbus_name,
                status=kwargs.get('status', 'pending'),
                timeout=self.event_timeout,
            )
            # logger.debug(f'Created EventResult for handler {handler_id}: {handler and get_handler_name(handler)}')

        # Update the EventResult with provided kwargs
        self.event_results[handler_id].update(**kwargs)
        # logger.debug(
        #     f'Updated EventResult for handler {handler_id}: status={self.event_results[handler_id].status}, total_results={len(self.event_results)}'
        # )
        # Don't mark complete here - let the EventBus do it after all handlers are done
        return self.event_results[handler_id]

    def event_mark_complete_if_all_handlers_completed(self) -> None:
        """Check if all handlers are done and signal completion"""
        if self.event_completed_signal and not self.event_completed_signal.is_set():
            # If there are no results at all, the event is complete
            if not self.event_results:
                if hasattr(self, 'event_processed_at'):
                    self.event_processed_at = datetime.now(UTC)
                self.event_completed_signal.set()
                return

            # Check if all handler results are done
            all_handlers_done = all(result.status in ('completed', 'error') for result in self.event_results.values())
            if not all_handlers_done:
                return

            # Recursively check if all child events are also complete
            if not self.event_are_all_children_complete():
                return

            # All handlers and all child events are done
            if hasattr(self, 'event_processed_at'):
                self.event_processed_at = datetime.now(UTC)
            self.event_completed_signal.set()

    def event_are_all_children_complete(self) -> bool:
        """Recursively check if all child events and their descendants are complete"""
        for child_event in self.event_children:
            if child_event.event_status != 'completed':
                logger.debug(f'Event {self} has incomplete child {child_event}')
                return False
            # Recursively check child's children
            if not child_event.event_are_all_children_complete():
                return False
        return True

    def event_log_safe_summary(self) -> dict[str, Any]:
        """only event metadata without contents, avoid potentially sensitive event contents in logs"""
        return {k: v for k, v in self.model_dump(mode='json').items() if k.startswith('event_') and 'results' not in k}

    def event_log_tree(
        self, indent: str = '', is_last: bool = True, child_events_by_parent: dict[str | None, list[BaseEvent]] | None = None
    ) -> None:
        """Print this event and its results with proper tree formatting"""
        from bubus.logging import log_event_tree

        log_event_tree(self, indent, is_last, child_events_by_parent)

    @property
    def event_bus(self) -> EventBus:
        """Get the EventBus that is currently processing this event"""
        from bubus.service import EventBus, inside_handler_context

        if not inside_handler_context.get():
            raise RuntimeError('event_bus property can only be accessed from within an event handler')

        # The event_path contains all buses this event has passed through
        # The last one in the path is the one currently processing
        if not self.event_path:
            raise RuntimeError('Event has no event_path - was it dispatched?')

        current_bus_name = self.event_path[-1]

        # Find the bus by name
        for bus in EventBus.all_instances:
            if bus and hasattr(bus, 'name') and bus.name == current_bus_name:
                return bus

        raise RuntimeError(f'Could not find active EventBus named {current_bus_name}')


def attr_name_allowed(key: str):
    return key in pydantic_builtin_attrs or key in event_builtin_attrs or key.startswith('_')


# PSA: All BaseEvent buil-in attrs and methods must be prefixed with "event_" in order to avoid clashing with data contents (which share a namespace with the metadata)
# This is the same approach Pydantic uses for their special `model_*` attrs (and BaseEvent is also a pydantic model, so model_ prefixes are reserved too)
# resist the urge to nest the event data in an inner object unless absolutely necessary, flat simplifies most of the code and makes it easier to read JSON logs with less nesting
pydantic_builtin_attrs = dir(BaseModel)
event_builtin_attrs = {key for key in dir(BaseEvent) if key.startswith('event_')}
illegal_attrs = {key for key in dir(BaseEvent) if not attr_name_allowed(key)}
assert not illegal_attrs, (
    'All BaseEvent attrs and methods must be prefixed with "event_" in order to avoid clashing '
    'with BaseEvent subclass fields used to store event contents (which share a namespace with the event_ metadata). '
    f'not allowed: {illegal_attrs}'
)


class EventResult(BaseModel):
    """Individual result from a single handler"""

    model_config = ConfigDict(
        extra='forbid',
        arbitrary_types_allowed=True,
        validate_assignment=True,
        validate_default=True,
        revalidate_instances='always',
    )

    # Result fields, updated by the EventBus._execute_sync_or_async_handler() calling event_result.update(...)
    result: Any = None
    error: BaseException | None = None
    event_children: list[BaseEvent] = Field(default_factory=list)  # type: ignore[misc]  # any child events that got dispatched during handler execution

    # Automatically set fields, updated by the EventBus._execute_sync_or_async_handler() calling event_result.update(...)
    id: UUIDStr = Field(default_factory=uuid7str)

    status: Literal['pending', 'started', 'completed', 'error'] = 'pending'
    event_id: UUIDStr
    handler_id: PythonIdStr
    handler_name: str
    eventbus_id: PythonIdStr
    eventbus_name: PythonIdentifierStr
    timeout: float | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None

    # Completion signal
    _handler_completed_signal: asyncio.Event | None = PrivateAttr(default=None)

    @property
    def handler_completed_signal(self) -> asyncio.Event | None:
        """Lazily create asyncio.Event when accessed"""
        if self._handler_completed_signal is None:
            try:
                asyncio.get_running_loop()
                self._handler_completed_signal = asyncio.Event()
            except RuntimeError:
                pass  # Keep it None if no event loop
        return self._handler_completed_signal

    def __str__(self) -> str:
        handler_qualname = f'{self.eventbus_name}.{self.handler_name}'
        return f'{handler_qualname}() -> {self.result or self.error or "..."} ({self.status})'

    def __repr__(self) -> str:
        icon = '🏃' if self.status == 'pending' else '✅' if self.status == 'completed' else '❌'
        return f'{self.handler_name}#{self.handler_id[-4:]}() {icon}'

    def __await__(self):
        """
        Wait for this result to complete and return the result or raise error.
        Does not execute the handler itself, only waits for it to be marked completed by the EventBus.
        EventBus triggers handlers and calls event_result.update() to mark them as started or completed.
        """

        async def wait_for_handler_to_complete_and_return_result():
            assert self.handler_completed_signal is not None, 'EventResult cannot be awaited outside of an async context'

            try:
                await asyncio.wait_for(self.handler_completed_signal.wait(), timeout=self.timeout)
            except TimeoutError:
                self.handler_completed_signal.clear()
                raise RuntimeError(f'Event handler {self.handler_name} timed out after {self.timeout}s')

            if self.status == 'error' and self.error:
                raise self.error if isinstance(self.error, BaseException) else Exception(self.error)  # pyright: ignore[reportUnnecessaryIsInstance]

            return self.result

        return wait_for_handler_to_complete_and_return_result().__await__()

    def update(self, **kwargs: Any) -> None:
        """Update the EventResult with provided kwargs, called by EventBus during handler execution."""
        if 'result' in kwargs:
            self.result = kwargs['result']
            self.status = 'completed'
        elif 'error' in kwargs:
            assert isinstance(kwargs['error'], (BaseException, str)), (
                f'Invalid error type: {type(kwargs["error"]).__name__} {kwargs["error"]}'
            )
            self.error = kwargs['error'] if isinstance(kwargs['error'], BaseException) else Exception(kwargs['error'])
            self.status = 'error'
        elif 'status' in kwargs:
            assert kwargs['status'] in ('pending', 'started', 'completed', 'error'), f'Invalid status: {kwargs["status"]}'
            self.status = kwargs['status']

        if self.status != 'pending' and not self.started_at:
            self.started_at = datetime.now(UTC)

        if self.status in ('completed', 'error') and not self.completed_at:
            self.completed_at = datetime.now(UTC)
            if self.handler_completed_signal:
                self.handler_completed_signal.set()

    def log_tree(
        self, indent: str = '', is_last: bool = True, child_events_by_parent: dict[str | None, list[BaseEvent]] | None = None
    ) -> None:
        """Print this result and its child events with proper tree formatting"""
        from bubus.logging import log_eventresult_tree

        log_eventresult_tree(self, indent, is_last, child_events_by_parent)


# Resolve forward references
BaseEvent.model_rebuild()
EventResult.model_rebuild()
