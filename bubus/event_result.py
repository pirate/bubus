import asyncio
import logging
import os
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Generator, Generic, Literal, Self, cast
from uuid_extensions import uuid7str

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr
from typing_extensions import TypeVar  # needed to get TypeVar(default=...) above python 3.11

from bubus.event_handler import PythonIdStr, PythonIdentifierStr, UUIDStr, T_EventResultType

if TYPE_CHECKING:
    from bubus.event_handler import EventHandler

BUBUS_LOG_LEVEL = os.getenv('BUBUS_LOG_LEVEL', 'WARNING')  # WARNING normally, otherwise DEBUG when testing
logger = logging.getLogger('bubus')
logger.setLevel(BUBUS_LOG_LEVEL)

if TYPE_CHECKING:
    from bubus.event import BaseEvent

class EventResult(BaseModel, Generic[T_EventResultType]):
    """Individual result from a single handler"""

    model_config = ConfigDict(
        extra='forbid',
        arbitrary_types_allowed=True,
        validate_assignment=False,  # Disable to allow flexible result types - validation handled in update()
        validate_default=True,
        revalidate_instances='always',
    )

    # Automatically set fields, setup at Event init and updated by the EventBus._execute_sync_or_async_handler() calling event_result.update(...)
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

    # Result fields, updated by the EventBus._execute_sync_or_async_handler() calling event_result.update(...)
    result: T_EventResultType | 'BaseEvent[Any]' | None = None
    error: BaseException | None = None
    completed_at: datetime | None = None

    # Completion signal
    _handler_completed_signal: asyncio.Event | None = PrivateAttr(default=None)

    # any child events that were emitted during handler execution are captured automatically and stored here to track hierarchy
    # note about why this is BaseEvent[Any] instead of a more specific type:
    #   unfortunately we cant determine child event types statically / it's not worth it to force child event types to be defined at compile-time
    #   so we just allow handlers to emit any BaseEvent subclass/instances with any result types
    #   in theory it's possible to define the entire event tree hierarchy at compile-time with something like ParentEvent[ChildEvent[GrandchildEvent[FinalResultValueType]]],
    #   it's not worth the complexity headache it would incur on users of the library though,
    #   and it would significantly reduce runtime flexibility, e.g. you couldn't define and dispatch arbitrary server-provided event types at runtime
    event_children: list['BaseEvent[Any]'] = Field(default_factory=list)  # pyright: ignore[reportUnknownVariableType]

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

    def __await__(self) -> Generator[Self, Any, T_EventResultType | 'BaseEvent[Any]' | None]:
        """
        Wait for this result to complete and return the result or raise error.
        Does not execute the handler itself, only waits for it to be marked completed by the EventBus.
        EventBus triggers handlers and calls event_result.update() to mark them as started or completed.
        """

        async def wait_for_handler_to_complete_and_return_result() -> T_EventResultType | 'BaseEvent[Any]' | None:
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

    def update(self, **kwargs: Any) -> Self:
        """Update the EventResult with provided kwargs, called by EventBus during handler execution."""
        from pydantic import TypeAdapter
        from bubus.event import BaseEvent

        # fix common mistake of returning an exception object instead of marking the event result as an error result
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
                # This is needed for event forwarding patterns like bus1.on('*', bus2.dispatch)
                if isinstance(result, BaseEvent):
                    self.result = cast(T_EventResultType, result)
                else:
                    # cast the return value to the expected type using TypeAdapter
                    try:
                        if issubclass(self.result_type, BaseModel):
                            # if expected result type is a pydantic model, validate it with pydantic
                            validated_result = self.result_type.model_validate(result)
                        else:
                            # cast the return value to the expected type e.g. int(result) / str(result) / list(result) / etc.
                            ResultType = TypeAdapter(self.result_type)
                            validated_result = ResultType.validate_python(result)

                        # Normal assignment works, make sure validate_assignment=False otherwise pydantic will attempt to re-validate it a second time
                        self.result = cast(T_EventResultType, validated_result)

                    except Exception as cast_error:
                        self.error = ValueError(
                            f'Event handler returned a value that did not match expected event_result_type: {self.result_type.__name__}({result}) -> {type(cast_error).__name__}: {cast_error}'
                        )
                        self.result = None
                        self.status = 'error'
            else:
                # No result_type specified or result is None - assign directly
                self.result = cast(T_EventResultType, result)

        if 'error' in kwargs:
            assert isinstance(kwargs['error'], (BaseException, str)), (
                f'Invalid error type: {type(kwargs["error"]).__name__} {kwargs["error"]}'
            )
            self.error = kwargs['error'] if isinstance(kwargs['error'], BaseException) else Exception(kwargs['error'])  # pyright: ignore[reportUnnecessaryIsInstance]
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


# Resolve forward references
EventResult.model_rebuild()