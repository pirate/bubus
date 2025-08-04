"""Test typed event results with automatic casting."""

import asyncio
from typing import Any

from pydantic import BaseModel

from bubus import BaseEvent, EventBus


class ScreenshotEventResult(BaseModel):
    screenshot_base64: bytes | None = None
    error: str | None = None


class ScreenshotEvent(BaseEvent[ScreenshotEventResult]):
    screenshot_width: int = 1080
    screenshot_height: int = 900
    event_result_type: Any = ScreenshotEventResult


class StringEvent(BaseEvent[str]):
    event_result_type: Any = str


class IntEvent(BaseEvent[int]):
    event_result_type: Any = int


async def test_pydantic_model_result_casting():
    """Test that handler results are automatically cast to Pydantic models."""
    print('\n=== Test Pydantic Model Result Casting ===')
    
    bus = EventBus(name='pydantic_test_bus')
    
    def screenshot_handler(event: ScreenshotEvent):
        # Return a dict that should be cast to ScreenshotEventResult
        return {
            'screenshot_base64': b"fake_screenshot_data",
            'error': None
        }
    
    bus.on('ScreenshotEvent', screenshot_handler)
    
    event = ScreenshotEvent(screenshot_width=1920, screenshot_height=1080)
    await bus.dispatch(event)
    
    # Get the result
    result = await event.event_result()
    
    # Verify it was cast to the correct type
    assert isinstance(result, ScreenshotEventResult)
    assert result.screenshot_base64 == b"fake_screenshot_data"
    assert result.error is None
    
    print(f'✅ Result correctly cast to {type(result).__name__}: {result}')
    await bus.stop(clear=True)


async def test_builtin_type_casting():
    """Test that handler results are automatically cast to built-in types."""
    print('\n=== Test Built-in Type Casting ===')
    
    bus = EventBus(name='builtin_test_bus')
    
    def string_handler(event: StringEvent):
        return 42  # Should be cast to "42"
    
    def int_handler(event: IntEvent):
        return "123"  # Should be cast to 123
    
    bus.on('StringEvent', string_handler)
    bus.on('IntEvent', int_handler)
    
    # Test string casting
    string_event = StringEvent()
    await bus.dispatch(string_event)
    string_result = await string_event.event_result()
    assert isinstance(string_result, str)
    assert string_result == "42"
    print(f'✅ Int 42 cast to string: "{string_result}"')
    
    # Test int casting
    int_event = IntEvent()
    await bus.dispatch(int_event)
    int_result = await int_event.event_result()
    assert isinstance(int_result, int)
    assert int_result == 123
    print(f'✅ String "123" cast to int: {int_result}')
    await bus.stop(clear=True)


async def test_casting_failure_handling():
    """Test that casting failures are handled gracefully."""
    print('\n=== Test Casting Failure Handling ===')
    
    bus = EventBus(name='failure_test_bus')
    
    def bad_handler(event: IntEvent):
        return "not_a_number"  # Should fail to cast to int
    
    bus.on('IntEvent', bad_handler)
    
    event = IntEvent()
    await bus.dispatch(event)
    
    # The event should complete but the result should be an error
    try:
        await event.event_results_by_handler_id(raise_if_any=False)
        handler_id = list(event.event_results.keys())[0]
        event_result = event.event_results[handler_id]
    except Exception:
        # If event_results_by_handler_id raises, get the result directly
        handler_id = list(event.event_results.keys())[0]
        event_result = event.event_results[handler_id]
    
    assert event_result.status == 'error'
    assert isinstance(event_result.error, ValueError)
    assert 'expected event_result_type' in str(event_result.error)
    
    print(f'✅ Casting failure handled: {event_result.error}')
    await bus.stop(clear=True)


async def test_no_casting_when_no_result_type():
    """Test that events without result_type work normally."""
    print('\n=== Test No Casting When No Result Type ===')
    
    bus = EventBus(name='normal_test_bus')
    
    class NormalEvent(BaseEvent[None]):
        pass  # No event_result_type specified
    
    def normal_handler(event: NormalEvent):
        return {"raw": "data"}
    
    bus.on('NormalEvent', normal_handler)
    
    event = NormalEvent()
    await bus.dispatch(event)
    
    result = await event.event_result()
    
    # Should remain as original dict, no casting
    assert isinstance(result, dict)
    assert result == {"raw": "data"}
    
    print(f'✅ No casting applied: {result}')
    await bus.stop(clear=True)


async def test_result_type_stored_in_event_result():
    """Test that result_type is stored in EventResult for inspection."""
    print('\n=== Test Result Type Stored in EventResult ===')
    
    bus = EventBus(name='storage_test_bus')
    
    def handler(event: StringEvent):
        return 123
    
    bus.on('StringEvent', handler)
    
    event = StringEvent()
    await bus.dispatch(event)
    
    # Check that result_type is accessible
    handler_id = list(event.event_results.keys())[0]
    event_result = event.event_results[handler_id]
    
    assert event_result.result_type is str
    assert isinstance(event_result.result, str)
    assert event_result.result == "123"
    
    print(f'✅ Result type stored: {event_result.result_type}')
    await bus.stop(clear=True)


async def test_typed_event_results():
    """Run all typed event result tests."""
    await test_pydantic_model_result_casting()
    await test_builtin_type_casting()
    await test_casting_failure_handling()
    await test_no_casting_when_no_result_type()
    await test_result_type_stored_in_event_result()
    print('\n🎉 All typed event result tests passed!')


if __name__ == '__main__':
    asyncio.run(test_pydantic_model_result_casting())
