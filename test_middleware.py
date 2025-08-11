#!/usr/bin/env python3
"""Simple test script to verify middleware implementation works."""

import asyncio
import tempfile
from pathlib import Path

from bubus import (
    AnalyticsEventBusMiddleware,
    BaseEvent,
    EventBus,
    HandlerCompletedAnalyticsEvent,
    HandlerStartedAnalyticsEvent,
    LoggerEventBusMiddleware,
    WALEventBusMiddleware,
)


class TestEvent(BaseEvent[str]):
    message: str


class TestEventWithoutHandler(BaseEvent[str]):
    message: str


async def test_basic_middleware():
    """Test basic middleware functionality"""
    print("=== Testing Basic Middleware ===")
    
    # Create analytics bus
    analytics_bus = EventBus(name='AnalyticsBus')
    
    # Create main bus with middlewares
    with tempfile.TemporaryDirectory() as tmp_dir:
        wal_path = Path(tmp_dir) / 'events.wal'
        
        main_bus = EventBus(
            name='MainBus',
            middlewares=[
                AnalyticsEventBusMiddleware(analytics_bus),
                WALEventBusMiddleware(wal_path),
                LoggerEventBusMiddleware('INFO'),
            ]
        )
        
        # Add a simple handler
        def test_handler(event: TestEvent) -> str:
            return f"Processed: {event.message}"
        
        main_bus.on(TestEvent, test_handler)
        
        # Add analytics handlers
        analytics_events = []
        
        def capture_analytics_start(event: HandlerStartedAnalyticsEvent) -> None:
            analytics_events.append(f"Started: {event.handler_name}")
            
        def capture_analytics_complete(event: HandlerCompletedAnalyticsEvent) -> None:
            analytics_events.append(f"Completed: {event.handler_name}, Error: {event.error}")
        
        analytics_bus.on(HandlerStartedAnalyticsEvent, capture_analytics_start)
        analytics_bus.on(HandlerCompletedAnalyticsEvent, capture_analytics_complete)
        
        # Test event with handler
        test_event = TestEvent(message="Hello World")
        completed_event = await main_bus.dispatch(test_event)
        result = await completed_event.event_result()
        
        print(f"Result: {result}")
        assert result == "Processed: Hello World"
        
        # Wait for analytics events
        await analytics_bus.wait_until_idle()
        
        print(f"Analytics events captured: {analytics_events}")
        
        # Check WAL file was created
        assert wal_path.exists(), "WAL file should have been created"
        wal_content = wal_path.read_text()
        print(f"WAL content length: {len(wal_content)} characters")
        
        # Test event without handler (should trigger StopIteration)
        no_handler_event = TestEventWithoutHandler(message="No handlers for this")
        completed_no_handler = await main_bus.dispatch(no_handler_event)
        
        print(f"Event without handlers status: {completed_no_handler.event_status}")
        
        await main_bus.stop(timeout=1.0)
        await analytics_bus.stop(timeout=1.0)
    
    print("✅ Basic middleware test passed!")


async def test_no_middleware():
    """Test that EventBus works without middleware (legacy mode)"""
    print("=== Testing Legacy Mode (No Middleware) ===")
    
    bus = EventBus(name='LegacyBus')
    
    def legacy_handler(event: TestEvent) -> str:
        return f"Legacy: {event.message}"
    
    bus.on(TestEvent, legacy_handler)
    
    test_event = TestEvent(message="Legacy test")
    completed = await bus.dispatch(test_event)
    result = await completed.event_result()
    
    print(f"Legacy result: {result}")
    assert result == "Legacy: Legacy test"
    
    await bus.stop(timeout=1.0)
    print("✅ Legacy mode test passed!")


async def main():
    """Run all tests"""
    try:
        await test_basic_middleware()
        await test_no_middleware()
        print("\n🎉 All tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    exit(asyncio.run(main()))