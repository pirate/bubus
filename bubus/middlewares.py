"""
Middleware system for EventBus with analytics, WAL, and logging support.

Middlewares follow Django-style nested function closure pattern with proper typing.
"""

import asyncio
import logging
import traceback
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

import anyio  # pyright: ignore[reportMissingImports]

from bubus.models import BaseEvent, T_EventResultType


logger = logging.getLogger('bubus')


class HandlerStartedAnalyticsEvent(BaseEvent[None]):
    """Analytics event dispatched before handler execution"""
    event_id: str
    started_at: datetime
    event_bus_id: str
    event_bus_name: str
    handler_id: str
    handler_name: str
    handler_class: str


class HandlerCompletedAnalyticsEvent(BaseEvent[None]):
    """Analytics event dispatched after handler execution"""
    event_id: str
    completed_at: datetime
    error: Exception | None
    traceback_info: str
    event_bus_id: str
    event_bus_name: str
    handler_id: str
    handler_name: str
    handler_class: str


def AnalyticsEventBusMiddleware(
    analytics_bus: 'Any'  # EventBus type, but avoid circular import
) -> Callable[[Callable[[BaseEvent[T_EventResultType]], T_EventResultType]], Callable[[BaseEvent[T_EventResultType]], T_EventResultType]]:
    """
    Analytics middleware that tracks handler execution with telemetry events.
    
    Args:
        analytics_bus: EventBus instance to dispatch analytics events to
    """
    
    def middleware_factory(execute_next_handler: Callable[[BaseEvent[T_EventResultType]], T_EventResultType]) -> Callable[[BaseEvent[T_EventResultType]], T_EventResultType]:
        # One-time configuration and initialization can go here
        
        async def middleware(event: BaseEvent[T_EventResultType]) -> T_EventResultType:
            from bubus.service import inside_handler_context, _current_event_context, _current_handler_id_context
            
            # Get current context information
            handler_id = _current_handler_id_context.get() or 'unknown_handler'
            current_event = _current_event_context.get()
            
            # Extract handler information from context
            handler_name = 'unknown_handler'
            handler_class = 'unknown_class'
            event_bus_id = '00000000000000'
            event_bus_name = 'EventBus'
            
            if current_event and hasattr(current_event, 'event_bus'):
                try:
                    bus = current_event.event_bus
                    event_bus_id = str(id(bus))
                    event_bus_name = bus.name
                except Exception:
                    pass
            
            # Dispatch analytics event before handler execution
            start_time = datetime.now(UTC)
            analytics_start_event = HandlerStartedAnalyticsEvent(
                event_id=event.event_id,
                started_at=start_time,
                event_bus_id=event_bus_id,
                event_bus_name=event_bus_name,
                handler_id=handler_id,
                handler_name=handler_name,
                handler_class=handler_class
            )
            analytics_bus.dispatch(analytics_start_event)
            
            error = None
            traceback_str = ''
            
            try:
                # Execute the next handler/middleware in chain
                response: T_EventResultType = await execute_next_handler(event)
                return response
            except StopIteration:
                # No handlers to execute, that's ok
                raise
            except Exception as e:
                error = e
                traceback_str = traceback.format_exc()
                raise
            finally:
                # Dispatch analytics event after handler execution
                completion_time = datetime.now(UTC)
                analytics_complete_event = HandlerCompletedAnalyticsEvent(
                    event_id=event.event_id,
                    completed_at=completion_time,
                    error=error,
                    traceback_info=traceback_str,
                    event_bus_id=event_bus_id,
                    event_bus_name=event_bus_name,
                    handler_id=handler_id,
                    handler_name=handler_name,
                    handler_class=handler_class
                )
                analytics_bus.dispatch(analytics_complete_event)
        
        middleware.__name__ = '_execute_next_handler_wrapped_by_AnalyticsEventBusMiddleware'
        return middleware
    
    return middleware_factory


def WALEventBusMiddleware(
    wal_path: Path | str | None
) -> Callable[[Callable[[BaseEvent[T_EventResultType]], T_EventResultType]], Callable[[BaseEvent[T_EventResultType]], T_EventResultType]]:
    """
    Write-Ahead Logging middleware that persists events to a WAL file.
    
    Args:
        wal_path: Path to the WAL file
    """
    
    def middleware_factory(execute_next_handler: Callable[[BaseEvent[T_EventResultType]], T_EventResultType]) -> Callable[[BaseEvent[T_EventResultType]], T_EventResultType]:
        # One-time configuration and initialization
        resolved_wal_path = Path(wal_path) if wal_path else None
        
        async def middleware(event: BaseEvent[T_EventResultType]) -> T_EventResultType:
            try:
                # Execute the next handler/middleware in chain
                response: T_EventResultType = await execute_next_handler(event)
                return response
            except StopIteration:
                # No handlers to execute, still log the event
                raise
            finally:
                # Always log the event to WAL after processing (or attempt)
                if resolved_wal_path:
                    try:
                        event_json = event.model_dump_json()  # pyright: ignore[reportUnknownMemberType]
                        resolved_wal_path.parent.mkdir(parents=True, exist_ok=True)
                        async with await anyio.open_file(resolved_wal_path, 'a', encoding='utf-8') as f:  # pyright: ignore[reportUnknownMemberType]
                            await f.write(event_json + '\n')  # pyright: ignore[reportUnknownMemberType]
                    except Exception as e:
                        logger.error(f'Failed to save event {event.event_id} to WAL file: {type(e).__name__} {e}\n{event}')
        
        middleware.__name__ = '_execute_next_handler_wrapped_by_WALEventBusMiddleware'
        return middleware
    
    return middleware_factory


def LoggerEventBusMiddleware(
    log_level: str = 'DEBUG'
) -> Callable[[Callable[[BaseEvent[T_EventResultType]], T_EventResultType]], Callable[[BaseEvent[T_EventResultType]], T_EventResultType]]:
    """
    Logging middleware that logs event processing.
    
    Args:
        log_level: Logging level to use
    """
    
    def middleware_factory(execute_next_handler: Callable[[BaseEvent[T_EventResultType]], T_EventResultType]) -> Callable[[BaseEvent[T_EventResultType]], T_EventResultType]:
        # One-time configuration and initialization
        log_func = getattr(logger, log_level.lower(), logger.debug)
        
        async def middleware(event: BaseEvent[T_EventResultType]) -> T_EventResultType:
            log_func(f'Processing event: {event.event_type}#{event.event_id[-8:]}')
            
            try:
                # Execute the next handler/middleware in chain
                response: T_EventResultType = await execute_next_handler(event)
                log_func(f'Event {event.event_type}#{event.event_id[-8:]} processed successfully')
                return response
            except StopIteration:
                log_func(f'Event {event.event_type}#{event.event_id[-8:]} has no handlers')
                raise
            except Exception as e:
                log_func(f'Event {event.event_type}#{event.event_id[-8:]} failed: {type(e).__name__}: {e}')
                raise
        
        middleware.__name__ = '_execute_next_handler_wrapped_by_LoggerEventBusMiddleware'
        return middleware
    
    return middleware_factory