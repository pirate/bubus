"""Test raise_if_* parameters in event handling."""

import asyncio

from bubus import BaseEvent, EventBus


class SimpleEvent(BaseEvent[str]):
    pass


class MultiHandlerEvent(BaseEvent[str]):
    pass


async def test_raise_if_unhandled():
    """Test that raise_if_unhandled raises when no handlers are registered."""
    print('\n=== Test raise_if_unhandled ===')
    
    bus = EventBus(name='unhandled_test')
    
    # Dispatch event with no handlers
    event = bus.dispatch(SimpleEvent())
    
    # Should raise when raise_if_unhandled=True
    try:
        await event.event_results_by_handler_id(raise_if_unhandled=True)
        assert False, 'Should have raised RuntimeError'
    except RuntimeError as e:
        assert 'No handlers were subscribed' in str(e)
    
    # Should not raise when raise_if_unhandled=False
    results = await event.event_results_by_handler_id(raise_if_unhandled=False)
    assert results == {}
    
    # event_result should raise by default (raise_if_unhandled=True)
    try:
        await event.event_result()
        assert False, 'Should have raised RuntimeError'
    except RuntimeError as e:
        assert 'No handlers were subscribed' in str(e)
    
    # Test with handler registered but returning None
    def none_handler(event: SimpleEvent):
        return None
    
    bus.on('SimpleEvent', none_handler)
    event2 = bus.dispatch(SimpleEvent())
    
    # Should not raise - handler was registered even though it returned None
    # Note: Since SimpleEvent is typed as BaseEvent[str], returning None causes a validation error
    # We need to pass raise_if_any_fail=False to handle this
    result = await event2.event_result(raise_if_unhandled=True, raise_if_all_none=False, raise_if_any_fail=False)
    assert result is None
    
    print('✅ raise_if_unhandled works correctly')
    await bus.stop(clear=True)


async def test_raise_if_multiple():
    """Test that raise_if_multiple raises when multiple handlers return results."""
    print('\n=== Test raise_if_multiple ===')
    
    bus = EventBus(name='multiple_test')
    
    def handler1(event: MultiHandlerEvent):
        return 'result1'
    
    def handler2(event: MultiHandlerEvent):
        return 'result2'
    
    bus.on('MultiHandlerEvent', handler1)
    bus.on('MultiHandlerEvent', handler2)
    
    event = bus.dispatch(MultiHandlerEvent())
    
    # event_result should raise when multiple handlers return results and raise_if_multiple=True (default)
    try:
        await event.event_result(raise_if_multiple=True)
        assert False, 'Should have raised RuntimeError'
    except RuntimeError as e:
        assert 'Multiple handlers returned results' in str(e)
    
    # Should not raise when raise_if_multiple=False, should return first result
    result = await event.event_result(raise_if_multiple=False)
    assert result in ['result1', 'result2']  # Either is valid since order isn't guaranteed
    
    # Test with only one handler returning non-None
    bus2 = EventBus(name='single_result_test')
    
    def none_handler(event: MultiHandlerEvent):
        return None
    
    def real_handler(event: MultiHandlerEvent):
        return 'single_result'
    
    bus2.on('MultiHandlerEvent', none_handler)
    bus2.on('MultiHandlerEvent', real_handler)
    
    event2 = bus2.dispatch(MultiHandlerEvent())
    
    # Should not raise even with raise_if_multiple=True since only one returns non-None
    result = await event2.event_result(raise_if_multiple=True)
    assert result == 'single_result'
    
    print('✅ raise_if_multiple works correctly')
    await bus.stop(clear=True)
    await bus2.stop(clear=True)


async def test_raise_if_unhandled_with_failing_handlers():
    """Test that raise_if_unhandled considers failed handlers as handling the event."""
    print('\n=== Test raise_if_unhandled with failing handlers ===')
    
    bus = EventBus(name='failed_handler_test')
    
    def failing_handler(event: SimpleEvent):
        raise ValueError("Handler failed")
    
    bus.on('SimpleEvent', failing_handler)
    
    event = bus.dispatch(SimpleEvent())
    
    # Should not raise "No handlers" error even though handler failed
    # The event was handled, just unsuccessfully
    try:
        await event.event_result(raise_if_unhandled=True, raise_if_any_fail=True)
        assert False, 'Should have raised ValueError'
    except ValueError as e:
        assert "Handler failed" in str(e)
    
    # When raise_if_any_fail=False, should return None but not raise "unhandled"
    result = await event.event_result(raise_if_unhandled=True, raise_if_any_fail=False, raise_if_all_none=False)
    assert result is None
    
    print('✅ raise_if_unhandled correctly handles failed handlers')
    await bus.stop(clear=True)


async def test_combined_raise_if_parameters():
    """Test combinations of raise_if_* parameters."""
    print('\n=== Test combined raise_if parameters ===')
    
    bus = EventBus(name='combined_test')
    
    # Test 1: Multiple handlers all returning None
    def none_handler1(event: SimpleEvent):
        return None
    
    def none_handler2(event: SimpleEvent):
        return None
    
    bus.on('SimpleEvent', none_handler1)
    bus.on('SimpleEvent', none_handler2)
    
    event1 = bus.dispatch(SimpleEvent())
    
    # Should raise when raise_if_all_none=True
    try:
        await event1.event_result(raise_if_all_none=True)
        assert False, 'Should have raised RuntimeError'
    except RuntimeError as e:
        assert 'All handlers returned None' in str(e)
    
    # Should not raise when raise_if_all_none=False
    result = await event1.event_result(raise_if_all_none=False, raise_if_multiple=False)
    assert result is None
    
    # Test 2: Mix of None and actual results with multiple handlers
    bus2 = EventBus(name='mixed_test')
    
    def mixed_handler1(event: SimpleEvent):
        return None
    
    def mixed_handler2(event: SimpleEvent):
        return 'result'
    
    def mixed_handler3(event: SimpleEvent):
        return 'another_result'
    
    bus2.on('SimpleEvent', mixed_handler1)
    bus2.on('SimpleEvent', mixed_handler2)
    bus2.on('SimpleEvent', mixed_handler3)
    
    event2 = bus2.dispatch(SimpleEvent())
    
    # Should raise when raise_if_multiple=True (2 non-None results)
    try:
        await event2.event_result(raise_if_multiple=True)
        assert False, 'Should have raised RuntimeError'
    except RuntimeError as e:
        assert 'Multiple handlers returned results' in str(e)
    
    # Should return first non-None when raise_if_multiple=False
    result = await event2.event_result(raise_if_multiple=False)
    assert result in ['result', 'another_result']
    
    print('✅ Combined raise_if parameters work correctly')
    await bus.stop(clear=True)
    await bus2.stop(clear=True)


async def main():
    """Run all raise_if tests."""
    await test_raise_if_unhandled()
    await test_raise_if_multiple()
    await test_raise_if_unhandled_with_failing_handlers()
    await test_combined_raise_if_parameters()
    print('\n🎉 All raise_if parameter tests passed!')


if __name__ == '__main__':
    asyncio.run(main())