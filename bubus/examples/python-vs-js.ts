/**
 * Key differences between Python and JavaScript implementations
 */

import { BaseEvent, EventBus } from '../src/index.js';

// 1. Event Definition
// Python: @dataclass with event decorator
// JS: Class extending BaseEvent
class UserEvent extends BaseEvent {
  constructor(
    public userId: string,
    public action: string
  ) {
    super({ event_type: 'UserEvent' });
  }
}

// 2. Event Bus Creation
const bus = new EventBus('myapp', {
  parallel_handlers: true  // Same as Python
});

// 3. Handler Registration
// Python: @bus.on(UserEvent)
// JS: bus.on() method
bus.on(UserEvent, async (event) => {
  console.log(`User ${event.userId} performed ${event.action}`);
  return { handled: true };
});

// 4. Event Dispatching
async function main() {
  const event = new UserEvent('123', 'login');
  
  // Dispatch is the same
  await bus.dispatch(event);
  
  // KEY DIFFERENCE: Waiting for completion
  // Python: await event
  // JS: await event.wait()
  await event.wait();
  
  // Result access is the same
  const result = await event.event_result();
  console.log('Result:', result);
  
  // 5. Serialization for cross-language communication
  // Event metadata fields are identical:
  console.log({
    event_type: event.event_type,
    event_id: event.event_id,
    event_schema: event.event_schema,
    event_created_at: event.event_created_at,
    // ... all other fields match Python
  });
  
  await bus.stop();
}

// 6. Key Implementation Differences:
// - No decorators (use method calls)
// - No AsyncLocalStorage by default (simpler parent tracking)
// - Must use .wait() instead of await event (avoids thenable issues)
// - Native Promise-based instead of asyncio
// - No built-in WAL support (can be added separately)

main().catch(console.error);