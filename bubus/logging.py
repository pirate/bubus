"""Helper functions for logging event trees and formatting"""

from collections import defaultdict
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from bubus.models import BaseEvent, EventResult
    from bubus.service import EventBus


def format_timestamp(dt: datetime | None) -> str:
    """Format a datetime for display"""
    if dt is None:
        return 'N/A'
    return dt.strftime('%H:%M:%S.%f')[:-3]  # Show time with milliseconds


def format_result_value(value: Any) -> str:
    """Format a result value for display"""
    if value is None:
        return 'None'
    if hasattr(value, 'event_type') and hasattr(value, 'event_id'):  # BaseEvent check without import
        return f'Event({value.event_type}#{value.event_id[-4:]})'
    if isinstance(value, (str, int, float, bool)):
        return repr(value)
    if isinstance(value, dict):
        return f'dict({len(value)} items)'  # type: ignore[arg-type]
    if isinstance(value, list):
        return f'list({len(value)} items)'  # type: ignore[arg-type]
    return f'{type(value).__name__}(...)'


def log_event_tree(
    event: 'BaseEvent[Any]',
    indent: str = '',
    is_last: bool = True,
    child_events_by_parent: dict[str | None, list['BaseEvent[Any]']] | None = None,
) -> None:
    """Print this event and its results with proper tree formatting"""
    # Determine the connector
    connector = '└── ' if is_last else '├── '

    # Print this event's line
    status_icon = '✅' if event.event_status == 'completed' else '🏃' if event.event_status == 'started' else '⏳'

    # Format timing info
    timing_str = f'[{format_timestamp(event.event_created_at)}'
    if event.event_completed_at and event.event_created_at:
        duration = (event.event_completed_at - event.event_created_at).total_seconds()
        timing_str += f' ({duration:.3f}s)'
    timing_str += ']'

    print(f'{indent}{connector}{status_icon} {event.event_type}#{event.event_id[-4:]} {timing_str}')

    # Calculate the new indent for children
    extension = '    ' if is_last else '│   '
    new_indent = indent + extension

    # Track which child events were printed via handlers to avoid duplicates
    printed_child_ids: set[str] = set()

    # Print each result
    if event.event_results:
        results_sorted = sorted(event.event_results.items(), key=lambda x: x[1].started_at or datetime.min.replace(tzinfo=UTC))

        # Calculate which is the last item considering both results and unmapped children
        unmapped_children: list['BaseEvent[Any]'] = []
        if child_events_by_parent:
            all_children = child_events_by_parent.get(event.event_id, [])
            for child in all_children:
                # Will be printed later if not already printed by a handler
                if child.event_id not in [c.event_id for r in event.event_results.values() for c in r.event_children]:
                    unmapped_children.append(child)

        total_items = len(results_sorted) + len(unmapped_children)

        for i, (_handler_id, result) in enumerate(results_sorted):
            is_last_item = i == total_items - 1
            log_eventresult_tree(result, new_indent, is_last_item, child_events_by_parent)
            # Track child events printed by this result
            for child in result.event_children:
                printed_child_ids.add(child.event_id)

    # Print unmapped children (those not printed by any handler)
    if child_events_by_parent:
        children = child_events_by_parent.get(event.event_id, [])
        for i, child in enumerate(children):
            if child.event_id not in printed_child_ids:
                is_last_child = i == len(children) - 1
                log_event_tree(child, new_indent, is_last_child, child_events_by_parent)


def log_eventresult_tree(
    result: 'EventResult[Any]',
    indent: str = '',
    is_last: bool = True,
    child_events_by_parent: dict[str | None, list['BaseEvent[Any]']] | None = None,
) -> None:
    """Print this result and its child events with proper tree formatting"""
    # Determine the connector
    connector = '└── ' if is_last else '├── '

    # Status icon
    result_icon = (
        '✅'
        if result.status == 'completed'
        else '❌'
        if result.status == 'error'
        else '🏃'
        if result.status == 'started'
        else '⏳'
    )

    # Format handler name with bus info
    handler_display = f'{result.eventbus_name}.{result.handler_name}#{result.handler_id[-4:]}'

    # Format the result line
    result_line = f'{indent}{connector}{result_icon} {handler_display}'

    # Add timing info
    if result.started_at:
        result_line += f' [{format_timestamp(result.started_at)}'
        if result.completed_at:
            duration = (result.completed_at - result.started_at).total_seconds()
            result_line += f' ({duration:.3f}s)'
        result_line += ']'

    # Add result value or error
    if result.status == 'error' and result.error:
        result_line += f' ❌ {type(result.error).__name__}: {str(result.error)}'
    elif result.status == 'completed':
        result_line += f' → {format_result_value(result.result)}'

    print(result_line)

    # Calculate the new indent for child events
    extension = '    ' if is_last else '│   '
    new_indent = indent + extension

    # Print child events dispatched by this handler
    if result.event_children:
        for i, child in enumerate(result.event_children):
            is_last_child = i == len(result.event_children) - 1
            log_event_tree(child, new_indent, is_last_child, child_events_by_parent)


def log_eventbus_tree(eventbus: 'EventBus') -> None:
    """Print a nice pretty formatted tree view of all events in the history including their results and child events recursively"""

    # Build a mapping of parent_id to child events
    parent_to_children: dict[str | None, list['BaseEvent[Any]']] = defaultdict(list)
    for event in eventbus.event_history.values():
        parent_to_children[event.event_parent_id].append(event)

    # Sort events by creation time
    for children in parent_to_children.values():
        children.sort(key=lambda e: e.event_created_at)

    # Find root events (those without parents or with self as parent)
    root_events = list(parent_to_children[None])

    # Also include events that have themselves as parent (edge case)
    for event in eventbus.event_history.values():
        if event.event_parent_id == event.event_id and event not in root_events:
            root_events.append(event)
            # Remove from its incorrect parent mapping to avoid double printing
            if event.event_id in parent_to_children:
                parent_to_children[event.event_id] = [
                    e for e in parent_to_children[event.event_id] if e.event_id != event.event_id
                ]

    print(f'\n📊 Event History Tree for {eventbus}')
    print('=' * 80)

    if not root_events:
        print('  (No events in history)')
        return

    # Print all root events using their log_tree helper method
    for i, event in enumerate(root_events):
        is_last = i == len(root_events) - 1
        log_event_tree(event, '', is_last, parent_to_children)

    print('=' * 80)
