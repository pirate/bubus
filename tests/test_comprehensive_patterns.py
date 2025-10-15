"""Test comprehensive event patterns including forwarding, async/sync dispatch, and parent-child tracking."""

import asyncio
from typing import Any

from bubus import BaseEvent, EventBus


class ParentEvent(BaseEvent[str]):
    pass


class ChildEvent(BaseEvent[str]):
    pass


class ImmediateChildEvent(BaseEvent[str]):
    pass


class QueuedChildEvent(BaseEvent[str]):
    pass


async def test_comprehensive_patterns():
    """Test all event patterns work correctly without race conditions."""
    print('\n=== Test Comprehensive Patterns ===')

    bus1 = EventBus(name='bus1')
    bus2 = EventBus(name='bus2')  # Fixed typo from 'bus1' to 'bus2'

    results: list[tuple[int, str]] = []
    execution_counter = {'count': 0}  # Use a dict to track execution order

    def child_bus2_event_handler(event: BaseEvent[str]) -> str:
        """This gets triggered when the event is forwarded to the second bus."""
        execution_counter['count'] += 1
        seq = execution_counter['count']
        event_type_short = event.__class__.__name__.replace('Event', '')
        print(f'[{seq}] child_bus2_event_handler: processing {event.__class__.__name__} on bus2')
        results.append((seq, f'bus2_handler_{event_type_short}'))
        return 'forwarded bus result'

    bus2.on('*', child_bus2_event_handler)  # register a handler on bus2
    bus1.on('*', bus2.dispatch)  # forward all events from bus1 -> bus2

    async def parent_bus1_handler(event: ParentEvent) -> str:
        # Only process the parent ParentEvent

        execution_counter['count'] += 1
        seq = execution_counter['count']
        print(f'\n[{seq}] parent_bus1_handler: START processing {event}')
        results.append((seq, 'parent_start'))

        # Pattern 1: Async dispatch - handlers run after parent completes
        print('\n1. Testing async dispatch...')
        child_event_async = bus1.dispatch(QueuedChildEvent())
        print(f'   child_event_async.event_status = {child_event_async.event_status}')
        assert child_event_async.event_status != 'completed'

        # Pattern 2: Sync dispatch with await - handlers run immediately
        print('\n2. Testing sync dispatch (await)...')
        child_event_sync = await bus1.dispatch(ImmediateChildEvent())
        print(f'   child_event_sync.event_status = {child_event_sync.event_status}')
        assert child_event_sync.event_status == 'completed'

        # Check that forwarded handler result is available
        print('\n3. Checking forwarded handler results...')
        print(f'   child_event_sync.event_results: {child_event_sync.event_results}')
        print(f'   child_event_sync.event_result_type: {child_event_sync.event_result_type}')
        event_results = await child_event_sync.event_results_list(raise_if_none=False)
        print(f'   Results: {event_results}')
        # The forwarding handler (bus.dispatch) returns the event object itself
        # We need to check if the child event was processed on bus2
        # Check that the event was forwarded by looking at:
        # 1. The event path includes bus2
        assert 'bus2' in child_event_sync.event_path
        # 2. Debug what handlers processed this event
        print('   Handlers that processed this event:')
        for result in child_event_sync.event_results.values():
            print(f'     - {result.handler_name} (bus: {result.eventbus_name})')
        # The event was processed by bus1 using bus2.dispatch handler
        assert any(
            'bus2' in result.handler_name and 'dispatch' in result.handler_name
            for result in child_event_sync.event_results.values()
        )
        print('   Event was successfully forwarded to bus2')

        # Check parent-child relationships
        print('\n4. Checking parent-child relationships...')
        print(f'   child_event_async.event_parent_id = {child_event_async.event_parent_id}')
        print(f'   child_event_sync.event_parent_id = {child_event_sync.event_parent_id}')
        print(f'   event.event_id = {event.event_id}')
        assert child_event_async.event_parent_id == event.event_id
        assert child_event_sync.event_parent_id == event.event_id

        execution_counter['count'] += 1
        seq = execution_counter['count']
        print(f'[{seq}] parent_bus1_handler: END')
        results.append((seq, 'parent_end'))
        return 'parent_done'

    bus1.on(ParentEvent, parent_bus1_handler)

    # Dispatch parent event and wait for completion
    print('\nDispatching parent event...')
    parent_event = await bus1.dispatch(ParentEvent())

    # Wait for all buses to finish processing
    await bus1.wait_until_idle()
    await bus2.wait_until_idle()

    # Verify all child events have correct parent
    print('\n5. Verifying all events have correct parent...')
    all_events = list(bus1.event_history.values())
    print(f'   Total events in history: {len(all_events)}')
    for i, event in enumerate(all_events):
        print(
            f'   Event {i}: {event.__class__.__name__}, id: {event.event_id[-4:]}, parent_id: {event.event_parent_id[-4:] if event.event_parent_id else "None"}'
        )

    # Child events should have parent's ID
    event_children = [e for e in all_events if isinstance(e, (ImmediateChildEvent, QueuedChildEvent))]
    assert all(event.event_parent_id == parent_event.event_id for event in event_children)

    # Sort results by sequence number to see actual execution order
    sorted_results = sorted(results, key=lambda x: x[0])
    execution_order = [item[1] for item in sorted_results]

    print('\nExecution order:')
    for seq, action in sorted_results:
        print(f'  [{seq}] {action}')

    # Verify the execution order
    # The actual order depends on handler registration and event processing
    print(f'\nActual execution order: {execution_order}')

    # 1. Parent handler starts
    assert execution_order[0] == 'parent_start'

    # 2. ImmediateChild is processed immediately (during await)
    assert 'bus2_handler_ImmediateChild' in execution_order

    # 3. Parent handler should finish (if no error)
    if 'parent_end' in execution_order:
        parent_end_idx = execution_order.index('parent_end')
        assert parent_end_idx > 1

    # 4. Count events: 1 ImmediateChild, 1 QueuedChild, 1 Parent
    assert execution_order.count('bus2_handler_ImmediateChild') == 1
    assert execution_order.count('bus2_handler_QueuedChild') == 1
    assert execution_order.count('bus2_handler_Parent') == 1

    print('\n✅ All comprehensive patterns work correctly!')

    # Print event history tree before stopping buses
    print('\nEvent History Trees:')
    print(f'bus1 has {len(bus1.event_history)} events in history')
    print(f'bus2 has {len(bus2.event_history)} events in history')

    # Debug: show which events have None parent
    print('\nEvents with no parent (roots):')
    for event in bus1.event_history.values():
        if event.event_parent_id is None:
            print(f'  - {event}')

    from bubus.logging import log_eventbus_tree

    log_eventbus_tree(bus1)
    log_eventbus_tree(bus2)

    await bus1.stop(clear=True)
    await bus2.stop(clear=True)


async def test_race_condition_stress():
    """Stress test to ensure no race conditions."""
    print('\n=== Test Race Condition Stress ===')

    bus1 = EventBus(name='bus1')
    bus2 = EventBus(name='bus2')

    results: list[str] = []

    async def child_handler(event: BaseEvent[str]) -> str:
        bus_name = event.event_path[-1] if event.event_path else 'unknown'
        results.append(f'child_{bus_name}')
        # Add small delay to simulate work
        await asyncio.sleep(0.001)
        return f'child_done_{bus_name}'

    async def parent_handler(event: BaseEvent[str]) -> str:
        # Dispatch multiple children in different ways
        children: list[BaseEvent[Any]] = []

        # Async dispatches
        for _ in range(3):
            children.append(bus1.dispatch(QueuedChildEvent()))

        # Sync dispatches
        for _ in range(3):
            child = await bus1.dispatch(ImmediateChildEvent())
            assert child.event_status == 'completed'
            children.append(child)

        # Verify all have correct parent
        assert all(c.event_parent_id == event.event_id for c in children)
        return 'parent_done'

    def bad_handler(bad: BaseEvent[Any]) -> None:
        pass

    # Setup forwarding
    bus1.on('*', bus2.dispatch)
    bus1.on(QueuedChildEvent, child_handler)
    bus1.on(ImmediateChildEvent, child_handler)
    bus2.on(QueuedChildEvent, child_handler)
    bus2.on(ImmediateChildEvent, child_handler)
    bus1.on(BaseEvent, parent_handler)
    bus1.on(BaseEvent, bad_handler)

    # Run multiple times to check for race conditions
    for run in range(5):
        results.clear()

        await bus1.dispatch(BaseEvent())
        await bus1.wait_until_idle()
        await bus2.wait_until_idle()

        # Should have 6 child events processed on each bus
        assert results.count('child_bus1') == 6, f'Run {run}: Expected 6 child_bus1, got {results.count("child_bus1")}'
        assert results.count('child_bus2') == 6, f'Run {run}: Expected 6 child_bus2, got {results.count("child_bus2")}'

    print('✅ No race conditions detected!')

    # Print event history tree for the last run
    print('\nEvent history for the last test run:')
    from bubus.logging import log_eventbus_tree

    log_eventbus_tree(bus1)
    log_eventbus_tree(bus2)

    await bus1.stop(clear=True)
    await bus2.stop(clear=True)


async def main():
    """Run all tests."""
    await test_comprehensive_patterns()
    await test_race_condition_stress()


if __name__ == '__main__':
    asyncio.run(main())
