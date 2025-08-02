"""
Test parent event tracking functionality in EventBus.
"""

import asyncio
from typing import Any

import pytest

from bubus import BaseEvent, EventBus


class ParentEvent(BaseEvent[str]):
    """Parent event that triggers child events"""

    event_result_type = str

    message: str


class ChildEvent(BaseEvent[str]):
    """Child event triggered by parent"""

    event_result_type = str

    data: str


class GrandchildEvent(BaseEvent[str]):
    """Grandchild event triggered by child"""

    event_result_type = str

    value: int


@pytest.fixture
async def eventbus():
    """Create an event bus for testing"""
    bus = EventBus(name='TestBus')
    yield bus
    await bus.stop(clear=True)


class TestParentEventTracking:
    """Test automatic parent event ID tracking"""

    async def test_basic_parent_tracking(self, eventbus: EventBus):
        """Test that child events automatically get event_parent_id"""
        child_events: list[BaseEvent[Any]] = []

        async def parent_handler(event: ParentEvent) -> str:
            # Handler that dispatches a child event
            child = ChildEvent(data=f'child_of_{event.message}')
            eventbus.dispatch(child)
            child_events.append(child)
            return 'parent_handled'

        eventbus.on('ParentEvent', parent_handler)  # type: ignore[reportUnknownArgumentType]

        # Dispatch parent event
        parent = ParentEvent(message='test_parent')
        parent_result = eventbus.dispatch(parent)

        # Wait for processing
        await eventbus.wait_until_idle()

        # Verify parent processed
        await parent_result
        parent_handler_result = next(
            (r for r in parent_result.event_results.values() if r.handler_name.endswith('parent_handler')), None
        )
        assert parent_handler_result is not None and parent_handler_result.result == 'parent_handled'

        # Verify child has event_parent_id set
        assert len(child_events) == 1
        child = child_events[0]
        assert child.event_parent_id == parent.event_id

    async def test_multi_level_parent_tracking(self, eventbus: EventBus):
        """Test parent tracking across multiple levels"""
        events_by_level: dict[str, BaseEvent[Any] | None] = {'parent': None, 'child': None, 'grandchild': None}

        async def parent_handler(event: BaseEvent[str]) -> str:
            events_by_level['parent'] = event
            child = ChildEvent(data='child_data')
            eventbus.dispatch(child)
            return 'parent'

        async def child_handler(event: BaseEvent[str]) -> str:
            events_by_level['child'] = event
            grandchild = GrandchildEvent(value=42)
            eventbus.dispatch(grandchild)
            return 'child'

        async def grandchild_handler(event: BaseEvent[str]) -> str:
            events_by_level['grandchild'] = event
            return 'grandchild'

        # Register handlers
        eventbus.on('ParentEvent', parent_handler)
        eventbus.on('ChildEvent', child_handler)
        eventbus.on('GrandchildEvent', grandchild_handler)

        # Start the chain
        parent = ParentEvent(message='root')
        eventbus.dispatch(parent)

        # Wait for all processing
        await eventbus.wait_until_idle()

        # Verify the parent chain
        assert events_by_level['parent'] is not None
        assert events_by_level['child'] is not None
        assert events_by_level['grandchild'] is not None

        # Verify the parent chain
        assert events_by_level['parent'].event_parent_id is None  # Root has no parent
        assert events_by_level['child'].event_parent_id == parent.event_id
        assert events_by_level['grandchild'].event_parent_id == events_by_level['child'].event_id

    async def test_multiple_children_same_parent(self, eventbus: EventBus):
        """Test multiple child events from same parent"""
        child_events: list[BaseEvent[Any]] = []

        async def parent_handler(event: BaseEvent[str]) -> str:
            # Dispatch multiple children
            for i in range(3):
                child = ChildEvent(data=f'child_{i}')
                eventbus.dispatch(child)
                child_events.append(child)
            return 'spawned_children'

        eventbus.on('ParentEvent', parent_handler)

        # Dispatch parent
        parent = ParentEvent(message='multi_child_parent')
        eventbus.dispatch(parent)

        await eventbus.wait_until_idle()

        # All children should have same parent
        assert len(child_events) == 3
        for child in child_events:
            assert child.event_parent_id == parent.event_id

    async def test_parallel_handlers_parent_tracking(self, eventbus: EventBus):
        """Test parent tracking with parallel handlers"""
        events_from_handlers: dict[str, list[BaseEvent[Any]]] = {'h1': [], 'h2': []}

        async def handler1(event: BaseEvent[str]) -> str:
            await asyncio.sleep(0.01)  # Simulate work
            child = ChildEvent(data='from_h1')
            eventbus.dispatch(child)
            events_from_handlers['h1'].append(child)
            return 'h1'

        async def handler2(event: BaseEvent[str]) -> str:
            await asyncio.sleep(0.02)  # Different timing
            child = ChildEvent(data='from_h2')
            eventbus.dispatch(child)
            events_from_handlers['h2'].append(child)
            return 'h2'

        # Both handlers respond to same event
        eventbus.on('ParentEvent', handler1)
        eventbus.on('ParentEvent', handler2)

        # Dispatch parent
        parent = ParentEvent(message='parallel_test')
        eventbus.dispatch(parent)

        await eventbus.wait_until_idle()

        # Both children should have same parent despite parallel execution
        assert len(events_from_handlers['h1']) == 1
        assert len(events_from_handlers['h2']) == 1
        assert events_from_handlers['h1'][0].event_parent_id == parent.event_id
        assert events_from_handlers['h2'][0].event_parent_id == parent.event_id

    async def test_explicit_parent_not_overridden(self, eventbus: EventBus):
        """Test that explicitly set event_parent_id is not overridden"""
        captured_child = None

        async def parent_handler(event: BaseEvent[Any]) -> str:
            nonlocal captured_child
            # Create child with explicit event_parent_id
            explicit_parent_id = '01234567-89ab-cdef-0123-456789abcdef'
            child = ChildEvent(data='explicit', event_parent_id=explicit_parent_id)
            eventbus.dispatch(child)
            captured_child = child
            return 'dispatched'

        eventbus.on('ParentEvent', parent_handler)

        parent = ParentEvent(message='test')
        eventbus.dispatch(parent)

        await eventbus.wait_until_idle()

        # Explicit event_parent_id should be preserved
        assert captured_child is not None
        assert captured_child.event_parent_id == '01234567-89ab-cdef-0123-456789abcdef'
        assert captured_child.event_parent_id != parent.event_id

    async def test_cross_eventbus_parent_tracking(self):
        """Test parent tracking across multiple EventBuses"""
        bus1 = EventBus(name='Bus1')
        bus2 = EventBus(name='Bus2')

        captured_events: list[tuple[str, BaseEvent[Any], BaseEvent[Any] | None]] = []

        async def bus1_handler(event: BaseEvent[Any]) -> str:
            # Dispatch child to bus2
            child = ChildEvent(data='cross_bus_child')
            bus2.dispatch(child)
            captured_events.append(('bus1', event, child))
            return 'bus1_handled'

        async def bus2_handler(event: BaseEvent[str]) -> str:
            captured_events.append(('bus2', event, None))
            return 'bus2_handled'

        bus1.on('ParentEvent', bus1_handler)
        bus2.on('ChildEvent', bus2_handler)

        try:
            # Dispatch parent to bus1
            parent = ParentEvent(message='cross_bus_test')
            bus1.dispatch(parent)

            await bus1.wait_until_idle()
            await bus2.wait_until_idle()

            # Verify parent tracking works across buses
            assert len(captured_events) == 2
            _, _parent_event, child_event = captured_events[0]
            _, received_child, _ = captured_events[1]

            assert child_event is not None and child_event.event_parent_id == parent.event_id
            assert received_child.event_parent_id == parent.event_id

        finally:
            await bus1.stop(clear=True)
            await bus2.stop(clear=True)

    async def test_sync_handler_parent_tracking(self, eventbus: EventBus):
        """Test parent tracking works with sync handlers"""
        child_events: list[BaseEvent[Any]] = []

        def sync_parent_handler(event: BaseEvent[str]) -> str:
            # Sync handler that dispatches child
            child = ChildEvent(data='from_sync')
            eventbus.dispatch(child)
            child_events.append(child)
            return 'sync_handled'

        eventbus.on('ParentEvent', sync_parent_handler)

        parent = ParentEvent(message='sync_test')
        eventbus.dispatch(parent)

        await eventbus.wait_until_idle()

        # Parent tracking should work even with sync handlers
        assert len(child_events) == 1
        assert child_events[0].event_parent_id == parent.event_id

    async def test_error_handler_parent_tracking(self, eventbus: EventBus):
        """Test parent tracking when handler errors occur"""
        child_events: list[BaseEvent[Any]] = []

        async def failing_handler(event: BaseEvent[str]) -> str:
            # Dispatch child before failing
            child = ChildEvent(data='before_error')
            eventbus.dispatch(child)
            child_events.append(child)
            raise ValueError(
                'Handler error - expected to fail - testing that parent event tracking works even when handlers error'
            )

        async def success_handler(event: BaseEvent[str]) -> str:
            # This should still run
            child = ChildEvent(data='after_error')
            eventbus.dispatch(child)
            child_events.append(child)
            return 'success'

        eventbus.on('ParentEvent', failing_handler)
        eventbus.on('ParentEvent', success_handler)

        parent = ParentEvent(message='error_test')
        eventbus.dispatch(parent)

        await eventbus.wait_until_idle()

        # Both children should have event_parent_id despite error
        assert len(child_events) == 2
        for child in child_events:
            assert child.event_parent_id == parent.event_id
