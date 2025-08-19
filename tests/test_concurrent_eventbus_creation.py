"""Test that creating EventBus instances during iteration doesn't cause RuntimeError."""

import asyncio

from bubus import EventBus, BaseEvent


class SimpleEvent(BaseEvent[None]):
    """Test event that creates a new EventBus when handled."""
    pass


class CreateBusEvent(BaseEvent[None]):
    """Event that triggers creation of a new EventBus."""
    pass


async def test_concurrent_eventbus_creation():
    """Test that we can create EventBus instances while iterating over all_instances."""
    
    # Create initial buses
    bus1 = EventBus(name="bus1")
    bus2 = EventBus(name="bus2")
    
    created_buses = []
    
    async def create_bus_handler(event: CreateBusEvent) -> None:
        """Handler that creates a new EventBus."""
        # This simulates the scenario where handling an event causes a new EventBus to be created
        new_bus = EventBus(name=f"dynamic_bus_{len(created_buses)}")
        created_buses.append(new_bus)
    
    # Register handler
    bus1.on(CreateBusEvent, create_bus_handler)
    
    # Dispatch event that will create new buses
    event = bus1.dispatch(CreateBusEvent())
    
    # This is where the error would occur - when the event is awaited,
    # it iterates over EventBus.all_instances while a handler creates new instances
    await event  # Should not raise RuntimeError
    
    # Test direct iteration during bus creation
    async def iterate_and_create():
        """Test iterating while creating buses in another task."""
        for _ in range(5):
            # This would previously fail with RuntimeError
            bus_count = len(list(EventBus.all_instances))
            assert bus_count >= 3  # At least our initial buses + created one
            await asyncio.sleep(0.01)
    
    async def create_buses():
        """Create buses while iteration is happening."""
        for i in range(5):
            EventBus(name=f"concurrent_bus_{i}")
            await asyncio.sleep(0.01)
    
    # Run both tasks concurrently
    await asyncio.gather(
        iterate_and_create(),
        create_buses()
    )
    
    # Cleanup
    await bus1.stop(timeout=0, clear=True)
    await bus2.stop(timeout=0, clear=True)
    for bus in created_buses:
        await bus.stop(timeout=0, clear=True)


async def test_eventbus_iteration_in_wait_for_handlers():
    """Test the specific case from AboutBlankWatchdog where iteration happens in wait_for_handlers_to_complete."""
    
    bus = EventBus(name="test_bus")
    
    async def slow_handler(event: SimpleEvent) -> None:
        """Handler that takes time to complete."""
        await asyncio.sleep(0.1)
        # Create a new bus during handling
        EventBus(name="created_during_handler")
    
    bus.on(SimpleEvent, slow_handler)
    
    # Dispatch event
    event = bus.dispatch(SimpleEvent())
    
    # This internally calls wait_for_handlers_to_complete_then_return_event
    # which iterates over EventBus.all_instances
    await event  # Should not raise RuntimeError
    
    # Cleanup
    await bus.stop(timeout=0, clear=True)
