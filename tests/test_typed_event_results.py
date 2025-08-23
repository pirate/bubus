"""Test typed event results with automatic casting."""

import asyncio
from typing import Any, assert_type

from pydantic import BaseModel

from bubus import BaseEvent, EventBus


class ScreenshotEventResult(BaseModel):
    screenshot_base64: bytes | None = None
    error: str | None = None


class ScreenshotEvent(BaseEvent[ScreenshotEventResult]):
    screenshot_width: int = 1080
    screenshot_height: int = 900


class StringEvent(BaseEvent[str]):
    pass


class IntEvent(BaseEvent[int]):
    pass


async def test_pydantic_model_result_casting():
    """Test that handler results are automatically cast to Pydantic models."""
    print('\n=== Test Pydantic Model Result Casting ===')

    bus = EventBus(name='pydantic_test_bus')

    def screenshot_handler(event: ScreenshotEvent):
        # Return a dict that should be cast to ScreenshotEventResult
        return {'screenshot_base64': b'fake_screenshot_data', 'error': None}

    bus.on('ScreenshotEvent', screenshot_handler)

    event = ScreenshotEvent(screenshot_width=1920, screenshot_height=1080)
    await bus.dispatch(event)

    # Get the result
    result = await event.event_result()

    # Verify it was cast to the correct type
    assert isinstance(result, ScreenshotEventResult)
    assert result.screenshot_base64 == b'fake_screenshot_data'
    assert result.error is None

    print(f'✅ Result correctly cast to {type(result).__name__}: {result}')
    await bus.stop(clear=True)


async def test_builtin_type_casting():
    """Test that handler results are automatically cast to built-in types."""
    print('\n=== Test Built-in Type Casting ===')

    bus = EventBus(name='builtin_test_bus')

    def string_handler(event: StringEvent):
        return '42'  # Return a proper string

    def int_handler(event: IntEvent):
        return 123  # Return a proper int

    bus.on('StringEvent', string_handler)
    bus.on('IntEvent', int_handler)

    # Test string validation
    string_event = StringEvent()
    await bus.dispatch(string_event)
    string_result = await string_event.event_result()
    assert isinstance(string_result, str)
    assert string_result == '42'
    print(f'✅ String "42" validated as str: "{string_result}"')

    # Test int validation
    int_event = IntEvent()
    await bus.dispatch(int_event)
    int_result = await int_event.event_result()
    assert isinstance(int_result, int)
    assert int_result == 123
    print(f'✅ Int 123 validated as int: {int_result}')
    await bus.stop(clear=True)


async def test_casting_failure_handling():
    """Test that casting failures are handled gracefully."""
    print('\n=== Test Casting Failure Handling ===')

    bus = EventBus(name='failure_test_bus')

    def bad_handler(event: IntEvent):
        return 'not_a_number'  # Should fail validation as int

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
        return {'raw': 'data'}

    bus.on('NormalEvent', normal_handler)

    event = NormalEvent()
    await bus.dispatch(event)

    result = await event.event_result()

    # Should remain as original dict, no casting
    assert isinstance(result, dict)
    assert result == {'raw': 'data'}

    print(f'✅ No casting applied: {result}')
    await bus.stop(clear=True)


async def test_result_type_stored_in_event_result():
    """Test that result_type is stored in EventResult for inspection."""
    print('\n=== Test Result Type Stored in EventResult ===')

    bus = EventBus(name='storage_test_bus')

    def handler(event: StringEvent):
        return '123'  # Already a string, will validate successfully

    bus.on('StringEvent', handler)

    event = StringEvent()
    await bus.dispatch(event)

    # Check that result_type is accessible
    handler_id = list(event.event_results.keys())[0]
    event_result = event.event_results[handler_id]

    assert event_result.result_type is str
    assert isinstance(event_result.result, str)
    assert event_result.result == '123'

    print(f'✅ Result type stored: {event_result.result_type}')
    await bus.stop(clear=True)


async def test_expect_type_inference():
    """Test that EventBus.expect() returns the correct typed event."""
    print('\n=== Test Expect Type Inference ===')

    bus = EventBus(name='expect_type_test_bus')

    class CustomResult(BaseModel):
        data: str

    class SpecificEvent(BaseEvent[CustomResult]):
        request_id: str = 'test123'

    # Start a task that will dispatch the event
    async def dispatch_later():
        await asyncio.sleep(0.01)
        bus.dispatch(SpecificEvent(request_id='req456'))

    dispatch_task = asyncio.create_task(dispatch_later())

    # Use expect with the event class - should return SpecificEvent type
    expected_event = await bus.expect(SpecificEvent, timeout=1.0)

    # Type checking - this should work without cast
    assert_type(expected_event, SpecificEvent)  # Verify type is SpecificEvent, not BaseEvent[Any]

    # Runtime check
    assert type(expected_event) is SpecificEvent
    assert expected_event.request_id == 'req456'

    # Test with filters - type should still be preserved
    async def dispatch_multiple():
        await asyncio.sleep(0.01)
        bus.dispatch(SpecificEvent(request_id='wrong'))
        bus.dispatch(SpecificEvent(request_id='correct'))

    dispatch_task2 = asyncio.create_task(dispatch_multiple())

    # Expect with include filter
    filtered_event = await bus.expect(
        SpecificEvent,
        include=lambda e: e.request_id == 'correct',  # type: ignore
        timeout=1.0,
    )

    assert_type(filtered_event, SpecificEvent)  # Should still be SpecificEvent
    assert type(filtered_event) is SpecificEvent
    assert filtered_event.request_id == 'correct'

    # Test with string event type - returns BaseEvent[Any]
    async def dispatch_string_event():
        await asyncio.sleep(0.01)
        bus.dispatch(BaseEvent(event_type='StringEvent'))

    dispatch_task3 = asyncio.create_task(dispatch_string_event())
    string_event = await bus.expect('StringEvent', timeout=1.0)

    assert_type(string_event, BaseEvent[Any])  # Should be BaseEvent[Any]
    assert string_event.event_type == 'StringEvent'

    await dispatch_task
    await dispatch_task2
    await dispatch_task3

    print(f'✅ Expect correctly preserved type: {type(expected_event).__name__}')
    print(f'✅ Expect with filter preserved type: {type(filtered_event).__name__}')
    print('✅ No cast() needed for expect() - type inference works!')
    await bus.stop(clear=True)


async def test_dispatch_type_inference():
    """Test that EventBus.dispatch() returns the same type as its input."""
    print('\n=== Test Dispatch Type Inference ===')

    bus = EventBus(name='type_inference_test_bus')

    class CustomResult(BaseModel):
        value: str

    class CustomEvent(BaseEvent[CustomResult]):
        pass

    # Create an event instance
    original_event = CustomEvent()

    # Dispatch should return the same type WITHOUT needing cast()
    dispatched_event = bus.dispatch(original_event)

    # Type checking - this should work without cast
    assert_type(dispatched_event, CustomEvent)  # Should be CustomEvent, not BaseEvent[Any]

    # Runtime check
    assert type(dispatched_event) is CustomEvent
    assert dispatched_event is original_event  # Should be the same object

    # The returned event should be fully typed
    async def handler(event: CustomEvent) -> CustomResult:
        return CustomResult(value='test')

    bus.on('CustomEvent', handler)

    # We should be able to use it without casting
    result = await dispatched_event.event_result()

    # Type checking for the result
    assert_type(result, CustomResult | None)  # Should be CustomResult | None

    # Test that we can access type-specific attributes without cast
    # This would fail type checking if dispatched_event was BaseEvent[Any]
    assert dispatched_event.event_type == 'CustomEvent'

    # Demonstrate the improvement - no cast needed!
    # Before: event = cast(CustomEvent, bus.dispatch(CustomEvent()))
    # After: event = bus.dispatch(CustomEvent())  # Type is preserved!

    print(f'✅ Dispatch correctly preserved type: {type(dispatched_event).__name__}')
    print('✅ No cast() needed - type inference works!')
    await bus.stop(clear=True)


async def test_typed_event_results():
    """Run all typed event result tests."""
    await test_pydantic_model_result_casting()
    await test_builtin_type_casting()
    await test_casting_failure_handling()
    await test_no_casting_when_no_result_type()
    await test_result_type_stored_in_event_result()
    await test_expect_type_inference()
    await test_dispatch_type_inference()
    print('\n🎉 All typed event result tests passed!')


if __name__ == '__main__':
    asyncio.run(test_pydantic_model_result_casting())
