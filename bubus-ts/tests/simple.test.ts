import { describe, it, expect } from 'vitest'
import { EventBus, BaseEvent, EventStatus } from '../src/index.js'

// Use `declare` for fields - no constructor needed!
class TestEvent extends BaseEvent<string> {
  declare message: string
}

describe('Simple EventBus', () => {
  it('should process an event', async () => {
    const bus = new EventBus({ name: 'SimpleBus' })

    bus.on(TestEvent, async (event) => {
      return `Received: ${event.message}`
    })

    const event = await bus.immediate(new TestEvent({ message: 'Hello' }))

    expect(event.eventStatus).toBe(EventStatus.COMPLETED)
    expect(await event.eventResult()).toBe('Received: Hello')

    await bus.stop({ clear: true })
  })
})
