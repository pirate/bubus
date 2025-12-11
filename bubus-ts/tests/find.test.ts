/**
 * Tests for the unified find() method and tree traversal helpers.
 * Translated from Python tests/test_find.py
 */

import { describe, it, expect } from 'vitest'
import { EventBus, BaseEvent } from '../src/index.js'

// =============================================================================
// Test Event Classes
// =============================================================================

class ParentEvent extends BaseEvent<string> {}
class ChildEvent extends BaseEvent<string> {}
class GrandchildEvent extends BaseEvent<string> {}
class UnrelatedEvent extends BaseEvent<string> {}

class ScreenshotEvent extends BaseEvent<string> {
  declare target_id: string
  declare full_page: boolean
}

class NavigateEvent extends BaseEvent<string> {
  declare url: string
}

class TabCreatedEvent extends BaseEvent<string> {
  declare tab_id: string
}

// =============================================================================
// Tree Traversal Helper Tests
// =============================================================================

describe('EventIsChildOf', () => {
  it('should return true for direct child relationship', async () => {
    const bus = new EventBus()

    try {
      const childEventRef: BaseEvent[] = []

      bus.on(ParentEvent, async (event) => {
        const child = await bus.immediate(new ChildEvent())
        childEventRef.push(child)
        return 'parent_done'
      })
      bus.on(ChildEvent, () => 'child_done')

      const parent = await bus.immediate(new ParentEvent())
      await bus.waitUntilIdle()

      const child = childEventRef[0]

      expect(bus.eventIsChildOf(child, parent)).toBe(true)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return true for grandchild relationship', async () => {
    const bus = new EventBus()

    try {
      const grandchildRef: BaseEvent[] = []

      bus.on(ParentEvent, async () => {
        await bus.immediate(new ChildEvent())
        return 'parent_done'
      })

      bus.on(ChildEvent, async () => {
        const grandchild = await bus.immediate(new GrandchildEvent())
        grandchildRef.push(grandchild)
        return 'child_done'
      })

      bus.on(GrandchildEvent, () => 'grandchild_done')

      const parent = await bus.immediate(new ParentEvent())
      await bus.waitUntilIdle()

      const grandchild = grandchildRef[0]

      expect(bus.eventIsChildOf(grandchild, parent)).toBe(true)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return false for unrelated events', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'parent_done')
      bus.on(UnrelatedEvent, () => 'unrelated_done')

      const parent = await bus.immediate(new ParentEvent())
      const unrelated = await bus.immediate(new UnrelatedEvent())

      expect(bus.eventIsChildOf(unrelated, parent)).toBe(false)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return false for same event', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      const event = await bus.immediate(new ParentEvent())

      expect(bus.eventIsChildOf(event, event)).toBe(false)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return false for reversed relationship', async () => {
    const bus = new EventBus()

    try {
      const childRef: BaseEvent[] = []

      bus.on(ParentEvent, async () => {
        const child = await bus.immediate(new ChildEvent())
        childRef.push(child)
        return 'parent_done'
      })
      bus.on(ChildEvent, () => 'child_done')

      const parent = await bus.immediate(new ParentEvent())
      await bus.waitUntilIdle()

      const child = childRef[0]

      expect(bus.eventIsChildOf(parent, child)).toBe(false)
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

describe('EventIsParentOf', () => {
  it('should return true for direct parent relationship', async () => {
    const bus = new EventBus()

    try {
      const childRef: BaseEvent[] = []

      bus.on(ParentEvent, async () => {
        const child = await bus.immediate(new ChildEvent())
        childRef.push(child)
        return 'parent_done'
      })
      bus.on(ChildEvent, () => 'child_done')

      const parent = await bus.immediate(new ParentEvent())
      await bus.waitUntilIdle()

      const child = childRef[0]

      expect(bus.eventIsParentOf(parent, child)).toBe(true)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return true for grandparent relationship', async () => {
    const bus = new EventBus()

    try {
      const grandchildRef: BaseEvent[] = []

      bus.on(ParentEvent, async () => {
        await bus.immediate(new ChildEvent())
        return 'parent_done'
      })

      bus.on(ChildEvent, async () => {
        const grandchild = await bus.immediate(new GrandchildEvent())
        grandchildRef.push(grandchild)
        return 'child_done'
      })

      bus.on(GrandchildEvent, () => 'grandchild_done')

      const parent = await bus.immediate(new ParentEvent())
      await bus.waitUntilIdle()

      const grandchild = grandchildRef[0]

      expect(bus.eventIsParentOf(parent, grandchild)).toBe(true)
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

// =============================================================================
// find() Basic Functionality Tests
// =============================================================================

describe('FindPastOnly', () => {
  it('should return matching event from history', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      const dispatched = await bus.immediate(new ParentEvent())

      const found = await bus.find(ParentEvent, { past: true, future: false })

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(dispatched.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should filter by time window with past as number', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      await bus.immediate(new ParentEvent())
      await new Promise((r) => setTimeout(r, 150))
      const newEvent = await bus.immediate(new ParentEvent())

      // With short past window, should find the new event
      const found = await bus.find(ParentEvent, { past: 0.1, future: false })
      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(newEvent.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return null when all events too old', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      await bus.immediate(new ParentEvent())
      await new Promise((r) => setTimeout(r, 150))

      // With very short past window, should find nothing
      const found = await bus.find(ParentEvent, { past: 0.05, future: false })
      expect(found).toBeNull()
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return null when no match', async () => {
    const bus = new EventBus()

    try {
      const found = await bus.find(ParentEvent, { past: true, future: false })
      expect(found).toBeNull()
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should respect where filter', async () => {
    const bus = new EventBus()

    try {
      bus.on(ScreenshotEvent, () => 'done')

      await bus.immediate(new ScreenshotEvent({ target_id: 'tab1', full_page: false }))
      const event2 = await bus.immediate(new ScreenshotEvent({ target_id: 'tab2', full_page: false }))

      const found = await bus.find(ScreenshotEvent, {
        where: (e) => (e as ScreenshotEvent).target_id === 'tab2',
        past: true,
        future: false,
      })

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(event2.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return most recent match', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      await bus.immediate(new ParentEvent())
      await new Promise((r) => setTimeout(r, 10))
      const event2 = await bus.immediate(new ParentEvent())

      const found = await bus.find(ParentEvent, { past: true, future: false })

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(event2.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

describe('FindFutureOnly', () => {
  it('should wait for future event', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      const dispatchAfterDelay = async () => {
        await new Promise((r) => setTimeout(r, 50))
        return await bus.immediate(new ParentEvent())
      }

      const [found, dispatched] = await Promise.all([
        bus.find(ParentEvent, { past: false, future: 1 }),
        dispatchAfterDelay(),
      ])

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(dispatched.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should timeout when no event', async () => {
    const bus = new EventBus()

    try {
      const start = Date.now()
      const found = await bus.find(ParentEvent, { past: false, future: 0.05 })
      const elapsed = (Date.now() - start) / 1000

      expect(found).toBeNull()
      expect(elapsed).toBeLessThan(0.2)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should ignore past events', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      await bus.immediate(new ParentEvent())

      const found = await bus.find(ParentEvent, { past: false, future: 0.05 })

      expect(found).toBeNull()
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

describe('FindNeitherPastNorFuture', () => {
  it('should return null immediately', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      await bus.immediate(new ParentEvent())

      const start = Date.now()
      const found = await bus.find(ParentEvent, { past: false, future: false })
      const elapsed = (Date.now() - start) / 1000

      expect(found).toBeNull()
      expect(elapsed).toBeLessThan(0.1)
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

describe('FindPastAndFuture', () => {
  it('should return past event immediately', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      const dispatched = await bus.immediate(new ParentEvent())

      const start = Date.now()
      const found = await bus.find(ParentEvent, { past: true, future: 5 })
      const elapsed = (Date.now() - start) / 1000

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(dispatched.event_id)
      expect(elapsed).toBeLessThan(0.1)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should wait for future when no past match', async () => {
    const bus = new EventBus()

    try {
      bus.on(ChildEvent, () => 'done')
      bus.on(ParentEvent, () => 'done')

      await bus.immediate(new ParentEvent())

      const dispatchAfterDelay = async () => {
        await new Promise((r) => setTimeout(r, 50))
        return await bus.immediate(new ChildEvent())
      }

      const [found, dispatched] = await Promise.all([
        bus.find(ChildEvent, { past: true, future: 1 }),
        dispatchAfterDelay(),
      ])

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(dispatched.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

// =============================================================================
// find() with child_of Tests
// =============================================================================

describe('FindWithChildOf', () => {
  it('should return child of specified parent', async () => {
    const bus = new EventBus()

    try {
      const childRef: BaseEvent[] = []

      bus.on(ParentEvent, async () => {
        const child = await bus.immediate(new ChildEvent())
        childRef.push(child)
        return 'parent_done'
      })
      bus.on(ChildEvent, () => 'child_done')

      const parent = await bus.immediate(new ParentEvent())
      await bus.waitUntilIdle()

      const found = await bus.find(ChildEvent, {
        childOf: parent,
        past: true,
        future: false,
      })

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(childRef[0].event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return null for non-child', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'parent_done')
      bus.on(UnrelatedEvent, () => 'unrelated_done')

      const parent = await bus.immediate(new ParentEvent())
      await bus.immediate(new UnrelatedEvent())

      const found = await bus.find(UnrelatedEvent, {
        childOf: parent,
        past: true,
        future: false,
      })

      expect(found).toBeNull()
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should find grandchild', async () => {
    const bus = new EventBus()

    try {
      const grandchildRef: BaseEvent[] = []

      bus.on(ParentEvent, async () => {
        await bus.immediate(new ChildEvent())
        return 'parent_done'
      })

      bus.on(ChildEvent, async () => {
        const grandchild = await bus.immediate(new GrandchildEvent())
        grandchildRef.push(grandchild)
        return 'child_done'
      })

      bus.on(GrandchildEvent, () => 'grandchild_done')

      const parent = await bus.immediate(new ParentEvent())
      await bus.waitUntilIdle()

      const found = await bus.find(GrandchildEvent, {
        childOf: parent,
        past: true,
        future: false,
      })

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(grandchildRef[0].event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

// =============================================================================
// Debouncing Pattern Tests
// =============================================================================

describe('DebouncingPattern', () => {
  it('should return existing fresh event', async () => {
    const bus = new EventBus()

    try {
      bus.on(ScreenshotEvent, () => 'done')

      const original = await bus.immediate(
        new ScreenshotEvent({ target_id: 'tab1', full_page: false })
      )

      const isFresh = (e: BaseEvent) =>
        (Date.now() - new Date(e.eventCompletedAt || e.event_created_at).getTime()) / 1000 < 5

      const result =
        (await bus.find(ScreenshotEvent, {
          where: (e) =>
            (e as ScreenshotEvent).target_id === 'tab1' && isFresh(e),
          past: true,
          future: false,
        })) ??
        (await bus.immediate(
          new ScreenshotEvent({ target_id: 'tab1', full_page: false })
        ))

      expect(result.event_id).toBe(original.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should dispatch new when no match', async () => {
    const bus = new EventBus()

    try {
      bus.on(ScreenshotEvent, () => 'done')

      const result =
        (await bus.find(ScreenshotEvent, {
          where: (e) => (e as ScreenshotEvent).target_id === 'tab1',
          past: true,
          future: false,
        })) ??
        (await bus.immediate(
          new ScreenshotEvent({ target_id: 'tab1', full_page: false })
        ))

      expect(result).not.toBeNull()
      expect((result as ScreenshotEvent).target_id).toBe('tab1')
      expect(result.eventStatus).toBe('completed')
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should return immediately without waiting for past search', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      const start = Date.now()
      const result = await bus.find(ParentEvent, { past: true, future: false })
      const elapsed = (Date.now() - start) / 1000

      expect(result).toBeNull()
      expect(elapsed).toBeLessThan(0.05)
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

// =============================================================================
// Race Condition Fix Tests
// =============================================================================

describe('RaceConditionFix', () => {
  it('should catch already fired event', async () => {
    const bus = new EventBus()

    try {
      const tabRef: BaseEvent[] = []

      bus.on(NavigateEvent, async () => {
        const tab = await bus.immediate(
          new TabCreatedEvent({ tab_id: 'new_tab' })
        )
        tabRef.push(tab)
        return 'navigate_done'
      })
      bus.on(TabCreatedEvent, () => 'tab_created')

      const navEvent = await bus.immediate(
        new NavigateEvent({ url: 'https://example.com' })
      )

      const found = await bus.find(TabCreatedEvent, {
        childOf: navEvent,
        past: true,
        future: false,
      })

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(tabRef[0].event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should filter to correct parent with child_of', async () => {
    const bus = new EventBus()

    try {
      bus.on(NavigateEvent, async (event) => {
        await bus.immediate(
          new TabCreatedEvent({ tab_id: `tab_for_${(event as NavigateEvent).url}` })
        )
        return 'navigate_done'
      })
      bus.on(TabCreatedEvent, () => 'tab_created')

      const nav1 = await bus.immediate(new NavigateEvent({ url: 'site1' }))
      const nav2 = await bus.immediate(new NavigateEvent({ url: 'site2' }))

      const tab1 = await bus.find(TabCreatedEvent, {
        childOf: nav1,
        past: true,
        future: false,
      })

      const tab2 = await bus.find(TabCreatedEvent, {
        childOf: nav2,
        past: true,
        future: false,
      })

      expect(tab1).not.toBeNull()
      expect(tab2).not.toBeNull()
      expect((tab1 as TabCreatedEvent).tab_id).toBe('tab_for_site1')
      expect((tab2 as TabCreatedEvent).tab_id).toBe('tab_for_site2')
    } finally {
      await bus.stop({ clear: true })
    }
  })
})

// =============================================================================
// Find with Future Waiting Tests (replacing expect() pattern)
// =============================================================================

describe('FindWithFutureWaiting', () => {
  it('should wait for future events using find', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      const dispatchAfterDelay = async () => {
        await new Promise((r) => setTimeout(r, 50))
        return await bus.immediate(new ParentEvent())
      }

      const [found, dispatched] = await Promise.all([
        bus.find(ParentEvent, { past: false, future: 1 }),
        dispatchAfterDelay(),
      ])

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(dispatched.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should work with where filter', async () => {
    const bus = new EventBus()

    try {
      bus.on(ScreenshotEvent, () => 'done')

      const dispatchEvents = async () => {
        await new Promise((r) => setTimeout(r, 20))
        await bus.immediate(
          new ScreenshotEvent({ target_id: 'wrong', full_page: false })
        )
        await new Promise((r) => setTimeout(r, 20))
        return await bus.immediate(
          new ScreenshotEvent({ target_id: 'correct', full_page: false })
        )
      }

      const [found] = await Promise.all([
        bus.find(ScreenshotEvent, {
          where: (e) => (e as ScreenshotEvent).target_id === 'correct',
          past: false,
          future: 1,
        }),
        dispatchEvents(),
      ])

      expect(found).not.toBeNull()
      expect((found as ScreenshotEvent).target_id).toBe('correct')
    } finally {
      await bus.stop({ clear: true })
    }
  })

  it('should support past=true to find already-dispatched events', async () => {
    const bus = new EventBus()

    try {
      bus.on(ParentEvent, () => 'done')

      const dispatched = await bus.immediate(new ParentEvent())

      const found = await bus.find(ParentEvent, { past: true, future: 5 })

      expect(found).not.toBeNull()
      expect(found!.event_id).toBe(dispatched.event_id)
    } finally {
      await bus.stop({ clear: true })
    }
  })
})
