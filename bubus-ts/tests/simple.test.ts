import { describe, it, expect } from 'vitest'
import { EventBus, BaseEvent, EventStatus } from '../src/index.js'

class TestEvent extends BaseEvent<string> {
  message: string

  constructor(data: { message: string }) {
    super({ ...data, event_type: 'TestEvent' })
    this.message = data.message
  }
}

describe('Simple EventBus', () => {
  it('should process an event', async () => {
    const bus = new EventBus({ name: 'SimpleBus' })

    console.log('1. Registering handler')
    bus.on(TestEvent, async (event) => {
      console.log('3. Handler executing with message:', event.message)
      return `Received: ${event.message}`
    })

    console.log('2. Dispatching event')
    const event = bus.dispatch(new TestEvent({ message: 'Hello' }))
    console.log('2.5. Event dispatched, status:', event.eventStatus)
    console.log('2.5. Event results size:', event.event_results.size)

    console.log('4. Waiting for event completion')
    await event.completed
    console.log('5. Event completed, status:', event.eventStatus)

    console.log('6. Getting result')
    const resultMap = await event.eventResultsByHandlerId({ raiseIfAny: false, raiseIfNone: false })
    console.log('7. Result map:', resultMap)

    const results = [...event.event_results.values()]
    console.log('8. Results:', results.map(r => ({ status: r.status, result: r.result, error: r.error?.message })))

    await bus.stop({ clear: true })
  }, 10000)
})
