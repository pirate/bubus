import asyncio
from uuid import uuid4

import pytest

from bubus.models import BaseEvent, EventResult, get_handler_id


class _StubEvent:
    """Minimal event-like object used to verify EventResult independence."""

    def __init__(self):
        self.event_id = 'stub-event'
        self.event_children: list[BaseEvent | _StubEvent] = []
        self.event_result_type = str
        self.event_timeout = 0.5
        self.event_processed_at = None
        self.event_results: dict[str, EventResult] = {}
        self._cancelled_due_to_error: BaseException | None = None

    def event_cancel_pending_child_processing(self, error: BaseException) -> None:
        self._cancelled_due_to_error = error


@pytest.mark.asyncio
async def test_event_result_execute_without_base_event() -> None:
    """EventResult should execute without requiring a real BaseEvent or EventBus."""

    stub_event = _StubEvent()

    event_result = EventResult(
        event_id=str(uuid4()),
        handler_id=str(id(lambda: None)),
        handler_name='handler',
        eventbus_id=str(id(object())),
        eventbus_name='Standalone',
        timeout=stub_event.event_timeout,
        result_type=str,
    )

    async def handler(event: _StubEvent) -> str:
        return 'ok'

    result_value = await event_result.execute(
        stub_event,
        handler,
        eventbus='StandaloneBus',
        timeout=stub_event.event_timeout,
    )

    assert result_value == 'ok'
    assert event_result.status == 'completed'
    assert event_result.result == 'ok'
    assert stub_event._cancelled_due_to_error is None


class StandaloneEvent(BaseEvent[str]):
    data: str


@pytest.mark.asyncio
async def test_event_and_result_without_eventbus() -> None:
    """Verify BaseEvent + EventResult work without instantiating an EventBus."""

    event = StandaloneEvent(data='message')

    def handler(evt: StandaloneEvent) -> str:
        return evt.data.upper()

    handler_id = get_handler_id(handler, None)
    pending_results = event.event_create_pending_results({handler_id: handler})
    event_result = pending_results[handler_id]

    value = await event_result.execute(
        event,
        handler,
        eventbus='StandaloneBus',
        timeout=event.event_timeout,
    )

    assert value == 'MESSAGE'
    assert event_result.status == 'completed'
    assert event.event_results[handler_id] is event_result

    event.event_mark_complete_if_all_handlers_completed()
    assert event.event_completed_at is not None
