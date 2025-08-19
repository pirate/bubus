import asyncio
import inspect
import os
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from typing import Any, Protocol, TypeAlias, runtime_checkable
from typing_extensions import TypeVar  # needed to get TypeVar(default=...) above python 3.11

from pydantic import AfterValidator
from typing import Annotated
from uuid import UUID

BUBUS_LOG_LEVEL = os.getenv('BUBUS_LOG_LEVEL', 'WARNING')  # WARNING normally, otherwise DEBUG when testing

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

T_EventResultType = TypeVar('T_EventResultType', bound=Any, default=None)

# Forward declaration for BaseEvent - will be properly imported later
if hasattr(__builtins__, 'TYPE_CHECKING'):  
    # This is a hack to detect if we're in type checking mode
    from typing import TYPE_CHECKING
    if TYPE_CHECKING:
        from bubus.event import BaseEvent
else:
    from typing import TYPE_CHECKING
    if TYPE_CHECKING:
        from bubus.event import BaseEvent

# TypeVar for BaseEvent and its subclasses
# We use contravariant=True because if a handler accepts BaseEvent,
# it can also handle any subclass of BaseEvent
T_Event = TypeVar('T_Event', bound='BaseEvent[Any]', contravariant=True, default='BaseEvent[Any]')

# For protocols with __func__ attributes, we need an invariant TypeVar
T_EventInvariant = TypeVar('T_EventInvariant', bound='BaseEvent[Any]', default='BaseEvent[Any]')

# Context variables to track current event and handler context
# These were moved here from service.py to avoid circular imports
_current_event_context: ContextVar['BaseEvent[Any] | None'] = ContextVar('current_event', default=None)
inside_handler_context: ContextVar[bool] = ContextVar('inside_handler', default=False)
holds_global_lock: ContextVar[bool] = ContextVar('holds_global_lock', default=False)
_current_handler_id_context: ContextVar[str | None] = ContextVar('current_handler_id', default=None)

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
    EventHandlerFunc['BaseEvent[Any]']
    | AsyncEventHandlerFunc['BaseEvent[Any]']
    | EventHandlerMethod['BaseEvent[Any]']
    | AsyncEventHandlerMethod['BaseEvent[Any]']
    | EventHandlerClassMethod['BaseEvent[Any]']
    | AsyncEventHandlerClassMethod['BaseEvent[Any]']
    # | Callable[['BaseEvent'], Any]  # Simple sync callable
    # | Callable[['BaseEvent'], Awaitable[Any]]  # Simple async callable
    # | Coroutine[Any, Any, Any]  # Direct coroutine
)

# ContravariantEventHandler is needed to allow handlers to accept any BaseEvent subclass in some signatures
ContravariantEventHandler: TypeAlias = (
    EventHandlerFunc[T_Event]  # cannot be BaseEvent or type checker will complain
    | AsyncEventHandlerFunc['BaseEvent[Any]']
    | EventHandlerMethod['BaseEvent[Any]']
    | AsyncEventHandlerMethod[T_Event]  # cannot be 'BaseEvent' or type checker will complain
    | EventHandlerClassMethod['BaseEvent[Any]']
    | AsyncEventHandlerClassMethod['BaseEvent[Any]']
)

def get_handler_name(handler: ContravariantEventHandler[T_Event]) -> str:
    assert hasattr(handler, '__name__'), f'Handler {handler} has no __name__ attribute!'
    if inspect.ismethod(handler):
        return f'{handler.__self__}.{handler.__name__}'
    elif callable(handler):
        return f'{handler.__module__}.{handler.__name__}'  # type: ignore
    else:
        raise ValueError(f'Invalid handler: {handler} {type(handler)}, expected a function, coroutine, or method')


def get_handler_id(handler: EventHandler, eventbus: Any = None) -> str:
    """Generate a unique handler ID based on the bus and handler instance."""
    if eventbus is None:
        return str(id(handler))
    return f'{id(eventbus)}.{id(handler)}'