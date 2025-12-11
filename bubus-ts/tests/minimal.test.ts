import { describe, it, expect } from 'vitest'
import { EventBus, BaseEvent } from '../src/index.js'

// No constructor needed for events with no custom fields
class SimpleEvent extends BaseEvent<string> {}

describe('Minimal EventBus Test', () => {
  it('should complete event', async () => {
    const bus = new EventBus({ name: 'MinimalBus' })

    bus.on(SimpleEvent, async () => {
      return 'done'
    })

    const event = await bus.dispatch(new SimpleEvent())

    expect(event.event_type).toBe('SimpleEvent')
    expect(await event.eventResult()).toBe('done')

    await bus.stop({ clear: true })
  })
})
