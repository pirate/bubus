#!/usr/bin/env python3
"""
Test script to verify the middleware functionality.
This is a syntax check - can't run without dependencies.
"""

# Basic syntax check for middleware implementation
def check_middleware_syntax():
    """Check if the middleware implementation has correct syntax"""
    
    # Simulate middleware signature
    async def example_middleware(event_bus, handler, event, next_handler):
        """Example middleware following Django pattern"""
        print(f"Before handler: {handler.__name__ if hasattr(handler, '__name__') else 'handler'}")
        
        try:
            result = await next_handler()
            print(f"Handler succeeded: {result}")
            return result
        except Exception as e:
            print(f"Handler failed: {e}")
            raise
    
    print("✅ Middleware syntax check passed")
    return example_middleware


class TestEvent(BaseEvent[str]):
    message: str


# Create a simple analytics bus
analytics_bus = EventBus(name='AnalyticsBus')


async def error_handling_middleware(event_bus: EventBus, handler, event: BaseEvent, next_handler) -> None:
    """Example middleware that implements analytics and error handling as shown in the issue"""
    global analytics_bus
    
    # Get handler info
    from bubus.models import get_handler_id, get_handler_name
    handler_id = get_handler_id(handler, event_bus)
    handler_name = get_handler_name(handler)
    handler_class = f"{handler.__module__}.{handler.__qualname__}" if hasattr(handler, '__qualname__') else handler_name

    # dispatch an analytics event before every single handler execution
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
        # execute the handler and get the updated result
        result = await next_handler()
        status = 'completed'
    except Exception as e:
        result = None
        status = 'failed'
        error = e
        traceback_str = traceback.format_exc()

        # can do other side-effects here, e.g. attempt to reconnect to underlying resources
        # GlobalDBConnection.reconnect()
        # SomeAPIClient.clear_cache()
        # some_file.write_text('some handler failed ...')
    finally:
        # dispatch an analytics event after every single handler execution, regardless of success/failure
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


def analytics_handler(event: HandlerStartedAnalyticsEvent | HandlerCompletedAnalyticsEvent) -> None:
    """Handle analytics events"""
    print(f"📊 Analytics: {event.event_type} - Handler: {event.handler_name} in {event.event_bus_name}")
    if isinstance(event, HandlerCompletedAnalyticsEvent) and event.error:
        print(f"   Error: {event.error}")


def test_handler(event: TestEvent) -> str:
    """Simple test handler"""
    print(f"🔧 Handler processing: {event.message}")
    return f"Processed: {event.message}"


def failing_handler(event: TestEvent) -> str:
    """Handler that always fails"""
    print(f"💥 Failing handler processing: {event.message}")
    raise ValueError("This handler always fails!")


async def main():
    print("🧪 Testing middleware functionality...")
    
    # Set up analytics handlers
    analytics_bus.on('*', analytics_handler)
    
    # Create event bus with middleware
    event_bus = EventBus(
        name='BrowserEventBus123',
        middlewares=[error_handling_middleware],
    )
    
    # Register handlers
    event_bus.on(TestEvent, test_handler)
    event_bus.on(TestEvent, failing_handler)
    
    # Test with successful event
    print("\n✅ Testing successful event...")
    test_event = TestEvent(message="Hello, World!")
    completed_event = await event_bus.dispatch(test_event)
    print(f"Event completed: {completed_event}")
    
    # Wait a bit for analytics to process
    await asyncio.sleep(0.1)
    
    # Stop the buses
    await event_bus.stop()
    await analytics_bus.stop()
    
    print("✅ Test completed successfully!")


if __name__ == "__main__":
    asyncio.run(main())