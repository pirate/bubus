"""Utility script to generate synthetic events for the monitor app."""

from __future__ import annotations

import argparse
import asyncio
import random
import string
from typing import Sequence

from bubus import BaseEvent, EventBus
from bubus.event_history import SQLiteEventHistory

from .config import resolve_db_path


class RandomTestEvent(BaseEvent):
    abc_payload_field: str
    xyz_category_field: str


class FollowUpEvent(BaseEvent):
    abc_parent_payload_field: str
    xyz_detail_field: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Generate random events for the bubus monitor.')
    parser.add_argument('--events', type=int, default=50, help='Number of events to emit.')
    parser.add_argument('--min-delay', type=float, default=0.2, help='Minimum delay between events (seconds).')
    parser.add_argument('--max-delay', type=float, default=1.0, help='Maximum delay between events (seconds).')
    parser.add_argument('--error-rate', type=float, default=0.2, help='Fraction of handlers that should raise an error.')
    parser.add_argument('--child-rate', type=float, default=0.3, help='Probability of dispatching a follow-up event.')
    parser.add_argument('--categories', nargs='*', default=['alpha', 'beta', 'gamma'], help='Event categories to sample.')
    return parser.parse_args()


def _random_text(length: int = 8) -> str:
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))


async def run_generator(args: argparse.Namespace) -> None:
    db_path = resolve_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    history = SQLiteEventHistory(db_path)
    bus = EventBus(name='MonitorGenerator', event_history=history)

    categories: Sequence[str] = args.categories or ['default']

    async def random_handler(event: RandomTestEvent) -> str:
        await asyncio.sleep(random.uniform(0.05, 0.4))
        if random.random() < args.error_rate:
            raise RuntimeError(f'Flaky handler failed for payload={event.abc_payload_field}')
        if random.random() < args.child_rate:
            follow_up = FollowUpEvent(
                abc_parent_payload_field=event.abc_payload_field,
                xyz_detail_field=_random_text(6),
            )
            bus.dispatch(follow_up)
        return event.abc_payload_field[::-1]

    async def followup_handler(event: FollowUpEvent) -> str:
        await asyncio.sleep(random.uniform(0.05, 0.3))
        return f'followup:{event.xyz_detail_field}'

    bus.on('RandomTestEvent', random_handler)
    bus.on('FollowUpEvent', followup_handler)

    print(f'🟢 Writing events to {db_path}')

    try:
        for _ in range(args.events):
            payload = _random_text(10)
            event = RandomTestEvent(
                abc_payload_field=payload,
                xyz_category_field=random.choice(list(categories)),
            )
            bus.dispatch(event)
            await asyncio.sleep(random.uniform(args.min_delay, args.max_delay))

        # Give handlers time to finish
        await bus.wait_until_idle()
    finally:
        await bus.stop()
        print('✅ Done')


def main() -> None:
    args = parse_args()
    asyncio.run(run_generator(args))


if __name__ == '__main__':
    main()
