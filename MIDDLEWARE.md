# EventBus Middleware System

This document describes the new middleware system added to the EventBus for custom error reporting, logging, telemetry, and other side effects.

## Overview

Middlewares allow you to wrap event handler execution with custom logic, enabling:
- **Analytics and telemetry** - Track handler execution and performance
- **Error handling** - Catch and handle exceptions from handlers
- **Authentication** - Check permissions before handler execution  
- **Logging** - Log all handler executions
- **Side effects** - Reconnect databases, clear caches, etc.

## Quick Start

```python
from bubus import EventBus, BaseEvent
import asyncio

class MyEvent(BaseEvent[str]):
    message: str

async def my_middleware(event_bus, handler, event, next_handler):
    """Simple logging middleware"""
    print(f"Before: {handler.__name__}")
    try:
        result = await next_handler()
        print(f"Success: {result}")
        return result
    except Exception as e:
        print(f"Error: {e}")
        raise

# Create EventBus with middleware
bus = EventBus(middlewares=[my_middleware])

# Register handler
bus.on(MyEvent, lambda e: f"Hello {e.message}")

# Dispatch event
await bus.dispatch(MyEvent(message="World"))
```

## Middleware Signature

```python
async def middleware(
    event_bus: EventBus,
    handler: EventHandler, 
    event: BaseEvent,
    next_handler: Callable[[], Awaitable[Any]]
) -> Any:
    """
    Args:
        event_bus: The EventBus instance processing the event
        handler: The handler function being executed
        event: The event being processed
        next_handler: Call this to execute the next middleware/handler in the chain
        
    Returns:
        The result from the handler (or modified result)
    """
```

## Built-in Analytics Events

The middleware system includes pre-built analytics events:

### HandlerStartedAnalyticsEvent
Dispatched before handler execution:
```python
{
    "event_id": "uuid-of-original-event",
    "started_at": "2025-01-01T23:59:59.999+00:00", 
    "event_bus_id": "123456789",
    "event_bus_name": "MyEventBus",
    "handler_id": "987654321.123456789",
    "handler_name": "my_module.my_function",
    "handler_class": "my_module.MyClass.my_method"
}
```

### HandlerCompletedAnalyticsEvent
Dispatched after handler execution:
```python
{
    "event_id": "uuid-of-original-event",
    "completed_at": "2025-01-01T23:59:59.999+00:00",
    "error": None,  # or Exception object if handler failed
    "traceback_info": "",  # or traceback string if handler failed
    "event_bus_id": "123456789", 
    "event_bus_name": "MyEventBus",
    "handler_id": "987654321.123456789",
    "handler_name": "my_module.my_function",
    "handler_class": "my_module.MyClass.my_method"
}
```

## Complete Analytics Example

```python
import asyncio
import traceback
from datetime import datetime, timezone
from bubus import EventBus, BaseEvent, HandlerStartedAnalyticsEvent, HandlerCompletedAnalyticsEvent

# Create analytics bus
analytics_bus = EventBus(name='AnalyticsBus')

async def analytics_middleware(event_bus, handler, event, next_handler):
    """Middleware that implements analytics and error handling"""
    global analytics_bus
    
    # Get handler info
    from bubus.models import get_handler_id, get_handler_name
    handler_id = get_handler_id(handler, event_bus)
    handler_name = get_handler_name(handler)
    handler_class = f"{handler.__module__}.{handler.__qualname__}" if hasattr(handler, '__qualname__') else handler_name

    # Dispatch analytics event before handler execution
    await analytics_bus.dispatch(HandlerStartedAnalyticsEvent(
        event_id=event.event_id,
        started_at=datetime.now(timezone.utc),
        event_bus_id=str(id(event_bus)),
        event_bus_name=event_bus.name,
        handler_id=handler_id,
        handler_name=handler_name,
        handler_class=handler_class,
    ))

    status, result, error, traceback_str = 'started', None, None, ''
    try:
        # Execute the handler
        result = await next_handler()
        status = 'completed'
    except Exception as e:
        result = None
        status = 'failed'  
        error = e
        traceback_str = traceback.format_exc()
        
        # Perform side effects here
        # GlobalDBConnection.reconnect()
        # SomeAPIClient.clear_cache()
        # logger.error(f"Handler failed: {e}")
    finally:
        # Dispatch analytics event after handler execution
        await analytics_bus.dispatch(HandlerCompletedAnalyticsEvent(
            event_id=event.event_id,
            completed_at=datetime.now(timezone.utc),
            error=error,
            traceback_info=traceback_str,
            event_bus_id=str(id(event_bus)),
            event_bus_name=event_bus.name,
            handler_id=handler_id,
            handler_name=handler_name,
            handler_class=handler_class,
        ))
    
    return result

# Set up analytics handler
def analytics_handler(event):
    print(f"📊 {event.event_type}: {event.handler_name} in {event.event_bus_name}")

analytics_bus.on('*', analytics_handler)

# Create main bus with middleware
event_bus = EventBus(name='MainBus', middlewares=[analytics_middleware])
```

## Middleware Chain Execution

Middlewares are executed in the order they are provided:

```python
async def first_middleware(event_bus, handler, event, next_handler):
    print("First - before")
    result = await next_handler()  # Calls second_middleware
    print("First - after") 
    return result

async def second_middleware(event_bus, handler, event, next_handler):
    print("Second - before")
    result = await next_handler()  # Calls the actual handler
    print("Second - after")
    return result

bus = EventBus(middlewares=[first_middleware, second_middleware])

# Execution order:
# first_middleware (before) -> second_middleware (before) -> handler -> 
# second_middleware (after) -> first_middleware (after)
```

## Best Practices

1. **Always call `next_handler()`** - Unless you want to prevent handler execution
2. **Handle exceptions** - Decide whether to catch, log, and/or re-raise errors
3. **Keep middlewares focused** - Each middleware should have a single responsibility
4. **Avoid blocking operations** - Use async operations to prevent blocking the event loop
5. **Consider performance** - Middlewares add overhead to every handler execution
6. **Use analytics events** - The built-in events provide a standard way to track execution

## Common Use Cases

### Error Reporting
```python
async def error_reporting_middleware(event_bus, handler, event, next_handler):
    try:
        return await next_handler()
    except Exception as e:
        # Report to external service
        await error_reporting_service.report(e, event, handler)
        raise
```

### Authentication  
```python
async def auth_middleware(event_bus, handler, event, next_handler):
    if requires_auth(event):
        if not check_permissions(event.user_id, event.event_type):
            raise PermissionError("Access denied")
    return await next_handler()
```

### Caching
```python
async def cache_middleware(event_bus, handler, event, next_handler):
    cache_key = f"{handler.__name__}:{hash(event)}"
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)
    
    result = await next_handler()
    await redis.set(cache_key, json.dumps(result), ex=3600)
    return result
```

### Rate Limiting
```python
async def rate_limit_middleware(event_bus, handler, event, next_handler):
    key = f"rate_limit:{event.user_id}:{handler.__name__}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 60)  # 1 minute window
    if count > 10:  # Max 10 per minute
        raise RateLimitError("Rate limit exceeded")
    return await next_handler()
```

## Migration from Event Handlers

This middleware system is distinct from `event_bus.on('*', handler)` because:

- **Middleware wraps execution** - Can run code before AND after handlers
- **Error handling control** - Can catch errors and decide whether to propagate them  
- **Result modification** - Can modify the result returned by handlers
- **Execution order** - Middlewares execute in a predictable chain
- **Handler metadata access** - Direct access to handler function and event bus

Compare:
```python
# Old way - event handler
bus.on('*', lambda e: logger.info(f"Event: {e.event_type}"))

# New way - middleware  
async def logging_middleware(event_bus, handler, event, next_handler):
    logger.info(f"Before: {event.event_type} -> {handler.__name__}")
    result = await next_handler()
    logger.info(f"After: {event.event_type} -> {result}")
    return result
```

The middleware system provides much more control and flexibility for cross-cutting concerns like analytics, authentication, caching, and error handling.