"""EventResult model for tracking handler execution results."""

import asyncio
import inspect
import logging
import os
from collections.abc import Generator
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Callable, Generic, Literal, Self, cast

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, TypeAdapter
from typing_extensions import TypeVar
from uuid_extensions import uuid7str

from bubus.event_handler import EventHandler

if TYPE_CHECKING:
    from bubus.event import BaseEvent

logger = logging.getLogger('bubus')
BUBUS_LOG_LEVEL = os.getenv('BUBUS_LOG_LEVEL', 'WARNING')
logger.setLevel(BUBUS_LOG_LEVEL)

T_EventResultType = TypeVar('T_EventResultType', bound=Any, default=None)

# Type aliases
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator


def validate_uuid_str(s: str) -> str:
    uuid = UUID(str(s))
    return str(uuid)


def validate_python_id_str(s: str) -> str:
    assert str(s).replace('.', '').isdigit(), f'Invalid Python ID: {s}'
    return str(s)


def validate_event_name(s: str) -> str:
    assert str(s).isidentifier() and not str(s).startswith('_'), f'Invalid event name: {s}'
    return str(s)


UUIDStr = Annotated[str, AfterValidator(validate_uuid_str)]
PythonIdStr = Annotated[str, AfterValidator(validate_python_id_str)]
PythonIdentifierStr = Annotated[str, AfterValidator(validate_event_name)]

EventResultFilter = Callable[['EventResult[Any]'], bool]


class EventResult(BaseModel, Generic[T_EventResultType]):
    """Individual result from a single handler execution."""

    model_config = ConfigDict(
        extra='forbid',
        arbitrary_types_allowed=True,
        validate_assignment=False,  # Disable to allow flexible result types - validation handled in update()
        validate_default=True,
        revalidate_instances='always',
    )

    # Automatically set fields, setup at Event init and updated by execute()
    id: UUIDStr = Field(default_factory=uuid7str)
    status: Literal['pending', 'started', 'completed', 'error'] = 'pending'
    event_id: UUIDStr
    handler_id: PythonIdStr
    handler_name: str
    result_type: Any | type[T_EventResultType] | None = None
    eventbus_id: PythonIdStr
    eventbus_name: PythonIdentifierStr
    timeout: float | None = None
    started_at: datetime | None = None

    # Result fields, updated by execute()
    if TYPE_CHECKING:
        result: 'T_EventResultType | BaseEvent[Any] | None' = None
    else:
        result: 'T_EventResultType | None' = None
    error: BaseException | None = None
    completed_at: datetime | None = None

    # Completion signal
    _handler_completed_signal: asyncio.Event | None = PrivateAttr(default=None)

    # Any child events that were emitted during handler execution
    if TYPE_CHECKING:
        event_children: list['BaseEvent[Any]'] = Field(default_factory=list)
    else:
        event_children: list[Any] = Field(default_factory=list)

    # Handler function reference (not serialized)
    _handler: EventHandler | None = PrivateAttr(default=None)
    if TYPE_CHECKING:
        _event: 'BaseEvent[Any] | None' = PrivateAttr(default=None)
    else:
        _event: 'Any | None' = PrivateAttr(default=None)

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

    def __await__(self) -> 'Generator[Any, None, T_EventResultType | BaseEvent[Any] | None]':
        """Wait for this result to complete and return the result or raise error."""
        return self.wait_for_completion().__await__()

    async def wait_for_completion(self) -> 'T_EventResultType | BaseEvent[Any] | None':
        """Wait for handler to complete and return the result."""
        assert self.handler_completed_signal is not None, 'EventResult cannot be awaited outside of an async context'

        try:
            await asyncio.wait_for(self.handler_completed_signal.wait(), timeout=self.timeout)
        except (TimeoutError, asyncio.TimeoutError) as e:
            self.handler_completed_signal.clear()
            raise TimeoutError(f'Event handler {self.handler_name} timed out after {self.timeout}s: {e}')

        if self.status == 'error' and self.error:
            raise self.error if isinstance(self.error, BaseException) else Exception(self.error)  # type: ignore

        return self.result

    async def execute(self, event: 'BaseEvent[T_EventResultType]', handler: EventHandler, eventbus: Any = None) -> T_EventResultType | None:
        """Execute the handler and update this EventResult with the outcome."""
        from bubus.event import BaseEvent
        from bubus.event_bus import _current_event_context, _current_handler_id_context, inside_handler_context  # type: ignore
        
        # Store references
        self._handler = handler
        self._event = event
        
        # Mark as started
        self.update(status='started')
        
        # Set the current event in context so child events can reference it
        token = _current_event_context.set(event)
        # Mark that we're inside a handler
        handler_token = inside_handler_context.set(True)
        # Set the current handler ID so child events can be tracked
        handler_id_token = _current_handler_id_context.set(self.handler_id)
        
        # Create a task to monitor for potential deadlock / slow handlers
        async def deadlock_monitor():
            await asyncio.sleep(15.0)
            logger.warning(
                f'⚠️ Handler {self.handler_name}({event}) has been running for >15. Possible slow processing or deadlock. '
                '(handler could be trying to await its own result or could be blocked by another async task).'
            )
        
        monitor_task = asyncio.create_task(
            deadlock_monitor(), 
            name=f'deadlock_monitor({event}, {self.handler_name}#{self.handler_id[-4:]})'
        )
        
        try:
            if inspect.iscoroutinefunction(handler):
                # Run async handler with timeout enforcement
                handler_coro = handler(event)  # type: ignore
                result_value: Any = await asyncio.wait_for(handler_coro, timeout=self.timeout)
            elif inspect.isfunction(handler) or inspect.ismethod(handler):
                # If handler function is sync function, run it directly in the main thread
                handler_start = asyncio.get_event_loop().time()
                result_value: Any = handler(event)
                handler_duration = asyncio.get_event_loop().time() - handler_start
                if self.timeout and handler_duration > self.timeout:
                    logger.warning(
                        f'⚠️ Sync handler {self.handler_name} took {handler_duration:.2f}s, '
                        f'exceeding timeout of {self.timeout}s (sync handlers cannot be interrupted)'
                    )
                
                # If the sync handler returned a BaseEvent (from dispatch), DON'T await it
                if isinstance(result_value, BaseEvent):
                    logger.debug(
                        f'Handler {self.handler_name} returned BaseEvent, not awaiting to avoid circular dependency'
                    )
            else:
                raise ValueError(f'Handler {self.handler_name} must be a sync or async function, got: {type(handler)}')
            
            logger.debug(
                f'    ↳ Handler {self.handler_name}#{self.handler_id[-4:]} returned: {type(result_value).__name__} {result_value}'
            )
            # Cancel the monitor task since handler completed successfully
            monitor_task.cancel()
            
            # Record successful result
            self.update(result=result_value)
            return cast(T_EventResultType, result_value)
            
        except TimeoutError as e:
            # This is a real timeout from asyncio.wait_for
            monitor_task.cancel()
            
            # Create a more informative timeout error
            timeout_error = TimeoutError(
                f'Handler {self.handler_name} exceeded timeout of {self.timeout}s '
                f'while processing {event.event_type}#{event.event_id[-4:]}'
            )
            
            # Record timeout error
            self.update(error=timeout_error)
            
            # Log the timeout with event tree for debugging
            from bubus.logging import log_timeout_tree  # type: ignore
            if eventbus:
                log_timeout_tree(eventbus, event, self)
            
            raise timeout_error
        except Exception as e:
            # Cancel the monitor task on error too
            monitor_task.cancel()
            
            # Record error
            self.update(error=e)
            
            logger.exception(
                f'❌ Error in event handler {self.handler_name}#{self.handler_id[-4:]}({event}) -> {type(e).__name__}({e})',
                exc_info=True,
            )
            raise
        finally:
            # Reset context
            _current_event_context.reset(token)
            inside_handler_context.reset(handler_token)
            _current_handler_id_context.reset(handler_id_token)
            # Ensure monitor task is cancelled
            try:
                if not monitor_task.done():
                    monitor_task.cancel()
                await monitor_task
            except asyncio.CancelledError:
                pass  # Expected when we cancel the monitor

    def update(self, **kwargs: Any) -> Self:
        """Update the EventResult with provided kwargs."""
        from bubus.event import BaseEvent
        
        # Fix common mistake of returning an exception object instead of marking as error
        if 'result' in kwargs and isinstance(kwargs['result'], BaseException):
            logger.warning(
                f'ℹ Event handler {self.handler_name} returned an exception object, auto-converting to EventResult(result=None, status="error", error={kwargs["result"]})'
            )
            kwargs['error'] = kwargs['result']
            kwargs['status'] = 'error'
            kwargs['result'] = None

        if 'result' in kwargs:
            result: Any = kwargs['result']
            self.status = 'completed'
            if self.result_type is not None and result is not None:
                # Always allow BaseEvent results without validation
                if isinstance(result, BaseEvent):
                    self.result = cast(T_EventResultType, result)
                else:
                    # Cast the return value to the expected type using TypeAdapter
                    try:
                        if isinstance(self.result_type, type) and issubclass(self.result_type, BaseModel):
                            # If expected result type is a pydantic model, validate it
                            validated_result = self.result_type.model_validate(result)
                        else:
                            # Cast the return value to the expected type
                            ResultType = TypeAdapter(self.result_type)
                            validated_result = ResultType.validate_python(result)

                        self.result = cast(T_EventResultType, validated_result)

                    except Exception as cast_error:
                        self.error = ValueError(
                            f'Event handler returned a value that did not match expected event_result_type: {self.result_type.__name__ if hasattr(self.result_type, "__name__") else self.result_type}({result}) -> {type(cast_error).__name__}: {cast_error}'
                        )
                        self.result = None
                        self.status = 'error'
                        # Ensure completed_at and signal are set for validation errors
                        if not self.completed_at:
                            self.completed_at = datetime.now(UTC)
                        if self.handler_completed_signal and not self.handler_completed_signal.is_set():
                            self.handler_completed_signal.set()
            else:
                # No result_type specified or result is None - assign directly
                self.result = cast(T_EventResultType, result)

        if 'error' in kwargs:
            assert isinstance(kwargs['error'], (BaseException, str)), (
                f'Invalid error type: {type(kwargs["error"]).__name__} {kwargs["error"]}'
            )
            self.error = kwargs['error'] if isinstance(kwargs['error'], BaseException) else Exception(kwargs['error'])  # type: ignore
            self.status = 'error'

        if 'status' in kwargs:
            assert kwargs['status'] in ('pending', 'started', 'completed', 'error'), f'Invalid status: {kwargs["status"]}'
            self.status = kwargs['status']

        if self.status != 'pending' and not self.started_at:
            self.started_at = datetime.now(UTC)

        if self.status in ('completed', 'error') and not self.completed_at:
            self.completed_at = datetime.now(UTC)
            if self.handler_completed_signal:
                self.handler_completed_signal.set()
        return self

    def log_tree(
        self, indent: str = '', is_last: bool = True, child_events_by_parent: dict[str | None, list['BaseEvent[Any]']] | None = None
    ) -> None:
        """Print this result and its child events with proper tree formatting"""
        from bubus.logging import log_eventresult_tree

        log_eventresult_tree(self, indent, is_last, child_events_by_parent)
