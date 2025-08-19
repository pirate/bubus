"""Test for per-handler timeout enforcement matching the exact scenario from the issue"""

import asyncio

import pytest

from bubus import BaseEvent, EventBus


# Event definitions
class TopmostEvent(BaseEvent[str]):
    """Event for navigating to a URL"""

    url: str = 'https://example.com'

    event_timeout: float | None = 30.0


class ChildEvent(BaseEvent[str]):
    """Event for tab creation"""

    tab_id: str = 'tab-123'

    event_timeout: float | None = 10.0


class GrandchildEvent(BaseEvent[str]):
    """Event for navigation completion"""

    success: bool = True

    event_timeout: float | None = 10.0


# Watchdog classes
class HandlerClass1:
    async def on_TopmostEvent(self, event: TopmostEvent) -> str:
        """Completes quickly - 1 second"""
        await asyncio.sleep(1)
        return 'security_check_passed'

    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Starts but gets interrupted after 1 second by parent timeout"""
        await asyncio.sleep(5)  # Would take 5 seconds but will be interrupted
        return 'navigation_security_check'


class HandlerClass2:
    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Completes instantly"""
        # No sleep - completes immediately
        return 'about_blank_check_passed'


class HandlerClass3:
    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Never gets to run - pending when timeout occurs"""
        await asyncio.sleep(1)
        return 'downloads_check'


class HandlerClass4:
    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Never gets to run - pending when timeout occurs"""
        await asyncio.sleep(1)
        return 'popups_check'


class MainClass0:
    def __init__(self, bus: EventBus):
        self.bus = bus

    async def on_TopmostEvent(self, event: TopmostEvent) -> str:
        """Takes 11 seconds total - dispatches ChildEvent"""
        # Do some work
        await asyncio.sleep(1)

        # Dispatch and wait for ChildEvent
        tab_event = self.bus.dispatch(ChildEvent())
        try:
            await tab_event  # This will timeout after 10s
        except Exception as e:
            print(f"DEBUG: Parent caught child error: {type(e).__name__}: {e}")
            raise

        # Would continue but won't get here due to timeout
        return 'navigation_complete'

    async def on_ChildEvent(self, event: ChildEvent) -> str:
        """Takes 10 seconds - will timeout, dispatches GrandchildEvent"""
        # Dispatch GrandchildEvent immediately
        nav_complete = self.bus.dispatch(GrandchildEvent())

        # Wait for GrandchildEvent to complete
        # This will take 9s (MainClass0) + 0s (AboutBlank) + partial HandlerClass1 time
        # Since handlers run serially and we have a 10s timeout, we'll timeout while
        # HandlerClass1 is still running (after about 1s of its 5s execution)
        await nav_complete
        
        # Would continue but we timeout first
        return 'tab_created'

    async def on_GrandchildEvent(self, event: GrandchildEvent) -> str:
        """Completes in 9 seconds"""
        await asyncio.sleep(9)
        return 'navigation_handled'


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
    with pytest.raises(Exception) as exc_info:
        await asyncio.wait_for(navigate_event, timeout=35)  # Give it 35s (parent timeout is 30s)

    # Verify the error chain
    print(f"Exception caught: {type(exc_info.value).__name__}: {exc_info.value}")
    # assert 'ChildEvent' in str(exc_info.value) or 'ChildEvent' in str(exc_info.value)

    # Check TopmostEvent results
    assert len(navigate_event.event_results) == 2

    # HandlerClass1.on_TopmostEvent should have completed
    security_result = next(r for r in navigate_event.event_results.values() if 'HandlerClass1' in r.handler_name)
    assert security_result.status == 'completed'
    assert security_result.result == 'security_check_passed'

    # MainClass0.on_TopmostEvent should have error (child timed out)
    browser_result = next(
        r
        for r in navigate_event.event_results.values()
        if 'MainClass0' in r.handler_name and 'TopmostEvent' in r.handler_name
    )
    assert browser_result.status == 'error'

    # Find the ChildEvent in children
    tab_event = browser_result.event_children[0]
    assert tab_event.event_type == 'ChildEvent'
    assert len(tab_event.event_results) == 1

    # MainClass0.ChildEvent should have timed out
    tab_result = list(tab_event.event_results.values())[0]
    assert tab_result.status == 'error'
    assert isinstance(tab_result.error, TimeoutError)
    assert 'exceeded timeout' in str(tab_result.error)

    # Find GrandchildEvent in tab handler's children
    nav_event = tab_result.event_children[0]
    assert nav_event.event_type == 'GrandchildEvent'

    # Check GrandchildEvent handlers
    nav_results = list(nav_event.event_results.values())
    print(f"DEBUG: nav_event has {len(nav_results)} results")
    for r in nav_results:
        print(f"  - {r.handler_name}: status={r.status}, started_at={r.started_at is not None}")

    # MainClass0.on_GrandchildEvent should complete (9s < 10s timeout)
    browser_nav_result = next(r for r in nav_results if 'MainClass0' in r.handler_name)
    assert browser_nav_result.status == 'completed'
    assert browser_nav_result.result == 'navigation_handled'

    # HandlerClass2 should complete instantly
    about_blank_result = next(r for r in nav_results if 'HandlerClass2' in r.handler_name)
    assert about_blank_result.status == 'completed'
    assert about_blank_result.result == 'about_blank_check_passed'

    # HandlerClass1.on_GrandchildEvent should be started but not completed (interrupted)
    security_nav_result = next(
        r for r in nav_results if 'HandlerClass1' in r.handler_name and r.eventbus_name == 'MainClass0EventBus'
    )
    # It should have started but not completed due to parent timeout
    assert security_nav_result.status == 'started'
    assert security_nav_result.started_at is not None
    assert security_nav_result.completed_at is None

    # HandlerClass3 and HandlerClass4 should never have started (pending)
    handler3_result = next((r for r in nav_results if 'HandlerClass3' in r.handler_name), None)
    handler4_result = next((r for r in nav_results if 'HandlerClass4' in r.handler_name), None)

    # These handlers may not have been executed at all due to serial execution
    # and the timeout occurring before they could start
    if handler3_result:
        assert handler3_result.status in ('pending', 'started')
    if handler4_result:
        assert handler4_result.status in ('pending', 'started')

    # Clean up
    await bus.stop(timeout=1)
