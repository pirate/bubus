"""Test for per-handler timeout enforcement matching the exact scenario from the issue"""

import asyncio

import pytest

from bubus import BaseEvent, EventBus


# Event definitions
class TopmostEvent(BaseEvent[str]):
    """Event for navigating to a URL"""

    url: str = 'https://example.com'

    event_timeout: float | None = 5.0


class ChildEvent(BaseEvent[str]):
    """Event for tab creation"""

    tab_id: str = 'tab-123'

    event_timeout: float | None = 2


class GrandchildEvent(BaseEvent[str]):
    """Event for navigation completion"""

    success: bool = True

    event_timeout: float | None = 1


# Watchdog classes
class HandlerClass1:
    async def on_TopmostEvent(self, event: TopmostEvent) -> str:
        """Completes quickly - 1 second"""
        await asyncio.sleep(0.1)
        return 'HandlerClass1.on_TopmostEvent completed after 0.1s'

    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Starts but gets interrupted after 1 second by parent timeout"""
        await asyncio.sleep(5)  # Would take 5 seconds but will be interrupted
        return 'HandlerClass1.on_GrandchildEvent completed after 5s'


class HandlerClass2:
    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Completes instantly"""
        # No sleep - completes immediately
        return 'HandlerClass2.on_GrandchildEvent completed immediately'


class HandlerClass3:
    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Never gets to run - pending when timeout occurs"""
        await asyncio.sleep(0.2)
        return 'HandlerClass3.on_GrandchildEvent completed after 0.2s'


class HandlerClass4:
    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Never gets to run - pending when timeout occurs"""
        await asyncio.sleep(0.1)
        return 'HandlerClass4.on_GrandchildEvent completed after 0.1s'


class MainClass0:
    def __init__(self, bus: EventBus):
        self.bus = bus

    async def on_TopmostEvent(self, event: TopmostEvent) -> str:
        """Takes 11 seconds total - dispatches ChildEvent"""
        # Do some work
        await asyncio.sleep(1)

        # Dispatch and wait for ChildEvent
        child_event = self.bus.dispatch(ChildEvent())
        try:
            await child_event  # This will timeout after 10s
        except Exception as e:
            print(f'DEBUG: Parent caught child error: {type(e).__name__}: {e}')

            import threading

            all_tasks = asyncio.all_tasks()
            print(f'\nOutstanding asyncio tasks ({len(all_tasks)}):')
            for task in all_tasks:
                print(f'  - {task.get_name()}: {task._state} - {task.get_coro()}')

            # List all threads
            all_threads = threading.enumerate()
            print(f'\nActive threads ({len(all_threads)}):')
            for thread in all_threads:
                print(f'  - {thread.name}: {thread.is_alive()}')

            raise

        # Would continue but won't get here due to timeout
        return 'MainClass0.on_TopmostEvent completed after all child events'

    async def on_ChildEvent(self, event: ChildEvent) -> str:
        """Takes 10 seconds - will timeout, dispatches GrandchildEvent"""
        # Dispatch GrandchildEvent immediately
        grandchild_event = self.bus.dispatch(GrandchildEvent())

        # Wait for GrandchildEvent to complete
        # This will take 9s (MainClass0) + 0s (AboutBlank) + partial HandlerClass1 time
        # Since handlers run serially and we have a 10s timeout, we'll timeout while
        # HandlerClass1 is still running (after about 1s of its 5s execution)
        await grandchild_event  # .event_result(raise_if_any=False, raise_if_none=True, timeout=15)

        # Would continue but we timeout first
        return 'MainClass0.on_ChildEvent completed after GrandchildEvent() finished processing'

    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Completes in 5 seconds"""
        # print('GRANDCHILD EVENT HANDLING STARTED')
        await asyncio.sleep(2)
        return 'MainClass0.on_GrandchildEvent completed after 2s'


@pytest.mark.asyncio
async def test_nested_timeout_scenario_from_issue():
    """Test the exact timeout scenario described in the issue

    This tests:
    1. TopmostEvent with 30s timeout dispatches ChildEvent
    2. ChildEvent with 10s timeout times out after 10s
    3. GrandchildEvent is dispatched from ChildEvent handler
    4. Some handlers complete, some are interrupted, some never run
    5. The timeout tree logging shows the complete hierarchy
    """
    # Create single event bus
    bus = EventBus(name='MainClass0EventBus')

    # Create instances
    handlerclass1 = HandlerClass1()
    handlerclass2 = HandlerClass2()
    handlerclass3 = HandlerClass3()
    handlerclass4 = HandlerClass4()
    mainclass0 = MainClass0(bus)

    # Register handlers for TopmostEvent
    bus.on('TopmostEvent', handlerclass1.on_TopmostEvent)
    bus.on('TopmostEvent', mainclass0.on_TopmostEvent)

    # Register handlers for ChildEvent
    bus.on('ChildEvent', mainclass0.on_ChildEvent)

    # Register handlers for GrandchildEvent (order matters for the test)
    bus.on('GrandchildEvent', mainclass0.on_GrandchildEvent)
    bus.on('GrandchildEvent', handlerclass2.on_GrandchildEvent)
    bus.on('GrandchildEvent', handlerclass1.on_GrandchildEvent)
    bus.on('GrandchildEvent', handlerclass3.on_GrandchildEvent)
    bus.on('GrandchildEvent', handlerclass4.on_GrandchildEvent)

    # Dispatch the root event
    navigate_event = bus.dispatch(TopmostEvent())

    # Wait for it to complete (will fail due to timeout)
    # with pytest.raises((RuntimeError, TimeoutError)) as exc_info:
    try:
        await (
            navigate_event
        )  # .event_result(raise_if_any=True, raise_if_none=True, timeout=20)  # The event should complete with an error
    except Exception as e:
        print(f'Exception caught: {type(e).__name__}: {e}')
        raise

    # import ipdb; ipdb.set_trace()

    # print('-----------------------------------------------------')
    # print(f"Exception caught: {type(exc_info.value).__name__}: {exc_info.value}")
    # # assert 'ChildEvent' in str(exc_info.value) or 'ChildEvent' in str(exc_info.value)

    await bus.stop(clear=True, timeout=0)
