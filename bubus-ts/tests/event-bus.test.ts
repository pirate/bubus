import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventBus, BaseEvent, EventStatus } from '../src/index.js'

// =============================================================================
// Test Event Classes
// Use `declare` for custom fields - NO constructor needed!
// event_type automatically defaults to the class name
// =============================================================================

class TestEvent extends BaseEvent<string> {
  declare message: string
}

class NumberEvent extends BaseEvent<number> {
  declare value: number
}

class ParentEvent extends BaseEvent<string> {}

class ChildEvent extends BaseEvent<string> {}

// =============================================================================
// Tests
// =============================================================================

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus({ name: 'TestBus' })
  })

  afterEach(async () => {
    await bus.stop({ clear: true })
  })

  describe('basic dispatch and handling', () => {
    it('should dispatch and handle a simple event', async () => {
      bus.on(TestEvent, async (event) => {
        return `Received: ${event.message}`
      })

      const event = bus.dispatch(new TestEvent({ message: 'Hello' }))
      const result = await event.eventResult()

      expect(result).toBe('Received: Hello')
    })

    it('should handle multiple handlers for same event', async () => {
      bus.on(TestEvent, async (event) => `First: ${event.message}`)
      bus.on(TestEvent, async (event) => `Second: ${event.message}`)

      const event = bus.dispatch(new TestEvent({ message: 'Test' }))
      const results = await event.eventResultsList()

      expect(results).toHaveLength(2)
      expect(results).toContain('First: Test')
      expect(results).toContain('Second: Test')
    })

    it('should handle events by string pattern', async () => {
      bus.on('TestEvent', async (event: TestEvent) => {
        return `String pattern: ${event.message}`
      })

      const event = bus.dispatch(new TestEvent({ message: 'Pattern' }))
      const result = await event.eventResult()

      expect(result).toBe('String pattern: Pattern')
    })

    it('should handle wildcard pattern (*)', async () => {
      const received: string[] = []

      bus.on('*', async (event: BaseEvent) => {
        received.push(event.event_type)
      })

      bus.dispatch(new TestEvent({ message: 'One' }))
      bus.dispatch(new NumberEvent({ value: 42 }))

      await bus.waitUntilIdle()

      expect(received).toContain('TestEvent')
      expect(received).toContain('NumberEvent')
    })
  })

  describe('event status lifecycle', () => {
    it('should track event status through lifecycle', async () => {
      bus.on(TestEvent, async (event) => {
        // During handler execution, status should be STARTED
        expect(event.eventStatus).toBe(EventStatus.STARTED)
        return 'done'
      })

      const event = bus.dispatch(new TestEvent({ message: 'Status test' }))
      // Note: Status might be PENDING or STARTED immediately after dispatch
      // since processing starts asynchronously in the same tick

      await event.completed
      expect(event.eventStatus).toBe(EventStatus.COMPLETED)
    })

    it('should set timestamps correctly', async () => {
      bus.on(TestEvent, async () => 'done')

      const beforeDispatch = new Date().toISOString()
      const event = bus.dispatch(new TestEvent({ message: 'Timestamps' }))
      await event.completed

      expect(event.event_created_at >= beforeDispatch).toBe(true)
      expect(event.eventStartedAt).not.toBeNull()
      expect(event.eventCompletedAt).not.toBeNull()
    })
  })

  describe('parent-child event tracking', () => {
    it('should track parent-child relationships', async () => {
      let childEvent: ChildEvent | null = null

      bus.on(ParentEvent, async () => {
        childEvent = new ChildEvent()
        bus.dispatch(childEvent)
        return 'parent done'
      })

      bus.on(ChildEvent, async () => 'child done')

      const parent = bus.dispatch(new ParentEvent())
      await bus.waitUntilIdle()

      expect(childEvent).not.toBeNull()
      expect(childEvent!.event_parent_id).toBe(parent.event_id)
      expect(parent.eventChildren).toContain(childEvent)
    })

    it('should nest multiple levels of child events', async () => {
      const order: string[] = []

      bus.on(ParentEvent, async () => {
        order.push('parent-start')
        bus.dispatch(new ChildEvent())
        order.push('parent-end')
        return 'parent'
      })

      bus.on(ChildEvent, async () => {
        order.push('child')
        return 'child'
      })

      const parent = bus.dispatch(new ParentEvent())
      await bus.waitUntilIdle()

      // Parent handler completes before child is processed (FIFO)
      expect(order).toEqual(['parent-start', 'parent-end', 'child'])
    })
  })

  describe('error handling', () => {
    it('should capture handler errors in event result', async () => {
      bus.on(TestEvent, async () => {
        throw new Error('Handler failed')
      })

      const event = bus.dispatch(new TestEvent({ message: 'Error test' }))

      await expect(event.eventResult()).rejects.toThrow('Handler failed')
      await bus.waitUntilIdle()
    })

    it('should allow getting results without raising errors', async () => {
      bus.on(TestEvent, async () => {
        throw new Error('Handler failed')
      })

      const event = bus.dispatch(new TestEvent({ message: 'Error test' }))

      const result = await event.eventResult({
        raiseIfAny: false,
        raiseIfNone: false,
      })
      expect(result).toBeNull()
      await bus.waitUntilIdle()
    })

    it('should mark errored handlers as COMPLETED with error set', async () => {
      bus.on(TestEvent, async () => {
        throw new Error('Oops')
      })

      const event = bus.dispatch(new TestEvent({ message: 'Status error' }))

      try {
        await event.eventResult()
      } catch {
        // Expected
      }

      const results = [...event.event_results.values()]
      expect(results[0]?.status).toBe(EventStatus.COMPLETED)
      expect(results[0]?.error).toBeInstanceOf(Error)
      await bus.waitUntilIdle()
    })
  })

  describe('result aggregation', () => {
    it('should get results by handler name', async () => {
      async function handlerA(event: TestEvent) {
        return 'A: ' + event.message
      }
      async function handlerB(event: TestEvent) {
        return 'B: ' + event.message
      }

      bus.on(TestEvent, handlerA)
      bus.on(TestEvent, handlerB)

      const event = bus.dispatch(new TestEvent({ message: 'test' }))
      const resultsByName = await event.eventResultsByHandlerName()

      expect(resultsByName.get('handlerA')).toBe('A: test')
      expect(resultsByName.get('handlerB')).toBe('B: test')
    })

    it('should merge dict results', async () => {
      bus.on(TestEvent, async () => ({ a: 1, b: 2 }))
      bus.on(TestEvent, async () => ({ c: 3, d: 4 }))

      const event = bus.dispatch(new TestEvent({ message: 'merge' }))
      const merged = await event.eventResultsFlatDict()

      expect(merged).toEqual({ a: 1, b: 2, c: 3, d: 4 })
    })

    it('should detect conflicting dict keys', async () => {
      bus.on(TestEvent, async () => ({ key: 1 }))
      bus.on(TestEvent, async () => ({ key: 2 }))

      const event = bus.dispatch(new TestEvent({ message: 'conflict' }))

      await expect(event.eventResultsFlatDict()).rejects.toThrow('would overwrite')
    })

    it('should merge list results', async () => {
      bus.on(TestEvent, async () => [1, 2])
      bus.on(TestEvent, async () => [3, 4])

      const event = bus.dispatch(new TestEvent({ message: 'list' }))
      const merged = await event.eventResultsFlatList()

      expect(merged).toEqual([1, 2, 3, 4])
    })
  })

  describe('event finding', () => {
    it('should find events in history', async () => {
      bus.on(TestEvent, async (e) => e.message)

      const event1 = bus.dispatch(new TestEvent({ message: 'first' }))
      const event2 = bus.dispatch(new TestEvent({ message: 'second' }))
      await bus.waitUntilIdle()

      const found = await bus.find(TestEvent, {
        where: (e) => (e as TestEvent).message === 'second',
        past: true,
        future: false,
      })

      expect(found?.event_id).toBe(event2.event_id)
    })

    it('should wait for future events', async () => {
      bus.on(TestEvent, async (e) => e.message)

      const findPromise = bus.find(TestEvent, {
        where: (e) => (e as TestEvent).message === 'future',
        past: false,
        future: 5,
      })

      // Dispatch after starting find
      setTimeout(() => {
        bus.dispatch(new TestEvent({ message: 'future' }))
      }, 100)

      const found = await findPromise
      expect((found as TestEvent).message).toBe('future')
    })

    it('should timeout when future event not found', async () => {
      const found = await bus.find(TestEvent, {
        past: false,
        future: 0.1, // 100ms timeout
      })

      expect(found).toBeNull()
    })
  })

  describe('bus lifecycle', () => {
    it('should wait until idle', async () => {
      const processed: string[] = []

      bus.on(TestEvent, async (e) => {
        await new Promise((r) => setTimeout(r, 50))
        processed.push(e.message)
        return e.message
      })

      bus.dispatch(new TestEvent({ message: '1' }))
      bus.dispatch(new TestEvent({ message: '2' }))

      await bus.waitUntilIdle()

      expect(processed).toEqual(['1', '2'])
    })

    it('should stop cleanly', async () => {
      bus.on(TestEvent, async (e) => e.message)

      bus.dispatch(new TestEvent({ message: 'before stop' }))
      await bus.stop({ timeout: 1 })

      expect(bus.isRunning).toBe(false)
    })

    it('should clear history on stop with clear=true', async () => {
      bus.on(TestEvent, async (e) => e.message)

      bus.dispatch(new TestEvent({ message: 'test' }))
      await bus.waitUntilIdle()

      expect(bus.eventHistory.size).toBe(1)

      await bus.stop({ clear: true })

      expect(bus.eventHistory.size).toBe(0)
    })
  })

  describe('event path tracking', () => {
    it('should track event path through bus', async () => {
      bus.on(TestEvent, async (e) => e.message)

      const event = bus.dispatch(new TestEvent({ message: 'path test' }))
      await event.completed

      expect(event.event_path).toContain('TestBus')
    })
  })

  describe('timeout handling', () => {
    it('should timeout slow handlers', async () => {
      bus.on(TestEvent, async () => {
        await new Promise((r) => setTimeout(r, 5000))
        return 'never'
      })

      const event = new TestEvent({ message: 'timeout' })
      event.event_timeout = 0.1 // 100ms

      const dispatchedEvent = bus.dispatch(event)

      await expect(dispatchedEvent.eventResult()).rejects.toThrow('timed out')
      await bus.waitUntilIdle()
    })
  })
})

describe('BaseEvent', () => {
  it('should generate unique event IDs', () => {
    const event1 = new TestEvent({ message: 'a' })
    const event2 = new TestEvent({ message: 'b' })

    expect(event1.event_id).not.toBe(event2.event_id)
  })

  it('should set event_type from class name', () => {
    const event = new TestEvent({ message: 'test' })
    expect(event.event_type).toBe('TestEvent')
  })

  it('should serialize to JSON', () => {
    const event = new TestEvent({ message: 'json test' })
    const json = event.toJSON()

    expect(json.event_type).toBe('TestEvent')
    expect(json.message).toBe('json test')
    expect(json.event_id).toBe(event.event_id)
  })
})
