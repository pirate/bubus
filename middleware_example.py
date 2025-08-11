#!/usr/bin/env python3
"""
Comprehensive example showing how to use the new middleware system.

This example demonstrates the middleware feature as requested in GitHub issue #8.
It shows how to implement analytics, error handling, and other side effects
using the middleware pattern.
"""
import asyncio
import traceback
from datetime import datetime, timezone

from bubus.service import EventBus
from bubus.models import (
    BaseEvent, 
    HandlerStartedAnalyticsEvent, 
    HandlerCompletedAnalyticsEvent,
    get_handler_id, 
    get_handler_name
)


# Example event classes
class UserLoginEvent(BaseEvent[dict]):
    username: str
    ip_address: str


class TaskCompletedEvent(BaseEvent[str]):
    task_id: str
    result: str


# Create analytics bus for tracking
analytics_bus = EventBus(name='AnalyticsBus')


async def analytics_middleware(event_bus: EventBus, handler, event: BaseEvent, next_handler) -> any:
    """
    Middleware that implements analytics and error handling as shown in the GitHub issue.
    
    This middleware:
    - Dispatches HandlerStartedAnalyticsEvent before handler execution
    - Executes the handler and captures any errors
    - Dispatches HandlerCompletedAnalyticsEvent after handler execution
    - Can perform side effects like reconnecting to databases, clearing caches, etc.
    """
    global analytics_bus
    
    # Get handler info
    handler_id = get_handler_id(handler, event_bus)
    handler_name = get_handler_name(handler)
    handler_class = f"{handler.__module__}.{handler.__qualname__}" if hasattr(handler, '__qualname__') else handler_name

    # Dispatch analytics event before every single handler execution
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
        # Execute the handler and get the updated result
        result = await next_handler()
        status = 'completed'
    except Exception as e:
        result = None
        status = 'failed'
        error = e
        traceback_str = traceback.format_exc()

        # Can do other side-effects here, e.g. attempt to reconnect to underlying resources
        # GlobalDBConnection.reconnect()
        # SomeAPIClient.clear_cache()
        # some_file.write_text('some handler failed ...')
        print(f"🔧 Middleware detected handler failure: {e}")
    finally:
        # Dispatch analytics event after every single handler execution, regardless of success/failure
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


async def auth_middleware(event_bus: EventBus, handler, event: BaseEvent, next_handler) -> any:
    """
    Example middleware that checks authentication for certain event types.
    """
    # Only check auth for login events
    if isinstance(event, UserLoginEvent):
        print(f"🔐 Auth middleware: Checking authentication for {event.username}")
        # Simulate auth check
        if event.username == "admin" and event.ip_address.startswith("192.168."):
            print("✅ Authentication passed")
        else:
            print("❌ Authentication failed")
            raise PermissionError(f"Authentication failed for user {event.username}")
    
    # Continue to next handler
    return await next_handler()


async def logging_middleware(event_bus: EventBus, handler, event: BaseEvent, next_handler) -> any:
    """
    Example middleware that logs all handler executions.
    """
    print(f"📝 Logging: Starting {get_handler_name(handler)} for {event.event_type}")
    
    try:
        result = await next_handler()
        print(f"📝 Logging: Completed {get_handler_name(handler)} successfully")
        return result
    except Exception as e:
        print(f"📝 Logging: Failed {get_handler_name(handler)} with error: {e}")
        raise


# Event handlers
def analytics_handler(event: HandlerStartedAnalyticsEvent | HandlerCompletedAnalyticsEvent) -> None:
    """Handle analytics events"""
    if isinstance(event, HandlerStartedAnalyticsEvent):
        print(f"📊 Analytics: Handler STARTED - {event.handler_name} in {event.event_bus_name}")
    elif isinstance(event, HandlerCompletedAnalyticsEvent):
        print(f"📊 Analytics: Handler COMPLETED - {event.handler_name} in {event.event_bus_name}")
        if event.error:
            print(f"   ❌ Error: {event.error}")


async def login_handler(event: UserLoginEvent) -> dict:
    """Handle user login events"""
    print(f"🔑 Processing login for user: {event.username} from {event.ip_address}")
    return {"status": "success", "user_id": 123, "session_token": "abc123"}


async def failing_login_handler(event: UserLoginEvent) -> dict:
    """Handler that always fails for demonstration"""
    print(f"💥 Failing handler for user: {event.username}")
    raise ValueError("This handler always fails for demo purposes!")


async def task_handler(event: TaskCompletedEvent) -> str:
    """Handle task completion events"""
    print(f"✅ Task {event.task_id} completed with result: {event.result}")
    return f"Acknowledged task {event.task_id}"


async def main():
    """Main demonstration function"""
    print("🚀 Middleware System Demonstration")
    print("=" * 50)
    
    # Set up analytics handlers
    analytics_bus.on('*', analytics_handler)
    
    # Create event bus with multiple middlewares
    # Middlewares are executed in order: logging -> auth -> analytics -> handler
    event_bus = EventBus(
        name='BrowserEventBus123',
        middlewares=[
            logging_middleware,
            auth_middleware, 
            analytics_middleware
        ],
    )
    
    # Register event handlers
    event_bus.on(UserLoginEvent, login_handler)
    event_bus.on(UserLoginEvent, failing_login_handler)
    event_bus.on(TaskCompletedEvent, task_handler)
    
    print("\n1️⃣ Testing successful login event...")
    login_event = UserLoginEvent(
        username="admin",
        ip_address="192.168.1.100"
    )
    completed_event = await event_bus.dispatch(login_event)
    print(f"Login event result: {await completed_event.event_result()}")
    
    print("\n2️⃣ Testing failed authentication...")
    try:
        failed_login = UserLoginEvent(
            username="hacker",
            ip_address="10.0.0.1"
        )
        await event_bus.dispatch(failed_login)
    except Exception as e:
        print(f"Expected authentication failure: {e}")
    
    print("\n3️⃣ Testing task completion event...")
    task_event = TaskCompletedEvent(
        task_id="task_123",
        result="Successfully processed 1000 records"
    )
    completed_task = await event_bus.dispatch(task_event)
    print(f"Task event result: {await completed_task.event_result()}")
    
    # Give analytics events time to process
    await asyncio.sleep(0.1)
    
    # Stop the buses
    await event_bus.stop()
    await analytics_bus.stop()
    
    print("\n✅ Middleware demonstration completed successfully!")
    print("\nKey features demonstrated:")
    print("- Multiple middlewares working together")
    print("- Analytics tracking with start/completion events") 
    print("- Error handling and side effects in middleware")
    print("- Authentication checks")
    print("- Comprehensive logging")
    print("- Clean separation of concerns")


if __name__ == "__main__":
    asyncio.run(main())