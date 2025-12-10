import { describe, it, expect } from 'vitest'
import { EventBus, BaseEvent } from '../src/index.js'

// No constructor needed for events with no custom fields
class SimpleEvent extends BaseEvent<string> {}

describe('Minimal EventBus Test', () => {
  it('should complete event', async () => {
    const bus = new EventBus({ name: 'MinimalBus' })

    bus.on(SimpleEvent, async (event) => {
      console.log('HANDLER: executing')
      return 'done'
    })

    console.log('TEST: dispatching')
    const event = bus.dispatch(new SimpleEvent())
    console.log('TEST: dispatched, now awaiting')

    // Try awaiting completion
    try {
      const completedEvent = await event.completed
      console.log('TEST: event completed', completedEvent?.event_type)
    } catch (err) {
      console.log('TEST: error', err)
    }

    console.log('TEST: done')
    await bus.stop({ clear: true })
  }, 15000)
})
