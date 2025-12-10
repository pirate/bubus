# bubus-ts

TypeScript port of the [bubus](https://github.com/browser-use/bubus) event bus library.

Production-ready event bus library for TypeScript - Browser & Node compatible using ESM.

## Features

- Async event handling with FIFO processing
- Type-safe events using Zod schemas
- Cross-language compatible with Python bubus
- Parent-child event tracking
- Event result aggregation (flat dict, flat list)
- Event finding in history and future waiting
- Middleware support
- Forward events between buses

## Installation

```bash
npm install bubus
# or
yarn add bubus
# or
pnpm add bubus
```

## Quick Start

```typescript
import { EventBus, BaseEvent } from 'bubus'

// Define a typed event - use `declare` for fields, NO constructor needed!
class UserCreatedEvent extends BaseEvent<string> {
  declare user_id: string
  declare email: string
}

// Create event bus
const bus = new EventBus({ name: 'MyBus' })

// Register async handler
bus.on(UserCreatedEvent, async (event) => {
  return `User ${event.user_id} created with email ${event.email}`
})

// Dispatch and await result
const event = bus.dispatch(new UserCreatedEvent({
  user_id: '123',
  email: 'test@example.com'
}))
await event.completed  // Wait for all handlers to finish
const result = await event.eventResult()
console.log(result) // 'User 123 created with email test@example.com'
```

## Event Patterns

```typescript
// By event class (recommended)
bus.on(UserCreatedEvent, async (event) => { ... })

// By event type string
bus.on('UserCreatedEvent', async (event) => { ... })

// Wildcard - handle all events
bus.on('*', async (event) => { ... })
```

## Parent-Child Events

Events dispatched from within a handler automatically track their parent:

```typescript
bus.on(ParentEvent, async (event) => {
  // Use event.eventBus to dispatch child events
  const child = (event.eventBus as EventBus).dispatch(new ChildEvent())

  // child.event_parent_id is automatically set to event.event_id
  console.log(child.event_parent_id === event.event_id) // true

  return 'parent done'
})

// After processing, access children
const parent = bus.dispatch(new ParentEvent())
await parent.completed
console.log(parent.eventChildren) // [ChildEvent, ...]
```

## Forward Events Between Buses

```typescript
const mainBus = new EventBus({ name: 'MainBus' })
const authBus = new EventBus({ name: 'AuthBus' })

// Forward all events from mainBus to authBus
mainBus.on('*', async (event) => {
  authBus.dispatch(event)
})

// Events flow through with path tracking (prevents loops)
const event = mainBus.dispatch(new LoginEvent())
await event.completed
console.log(event.event_path) // ['MainBus', 'AuthBus']
```

## Event Finding

```typescript
// Search history only (instant)
const event = await bus.find(ResponseEvent, { past: true, future: false })

// Wait for future event (up to 5 seconds)
const event = await bus.find(ResponseEvent, { past: false, future: 5 })

// Search history and wait for future
const event = await bus.find(ResponseEvent, { past: true, future: 5 })

// With filter
const event = await bus.find(ResponseEvent, {
  where: (e) => (e as ResponseEvent).request_id === myRequestId,
  future: 5
})

// Find child of a specific parent
const child = await bus.find(ChildEvent, {
  childOf: parentEvent,
  future: 5
})
```

## Result Aggregation

```typescript
// Multiple handlers returning dicts - merge them
bus.on(ConfigEvent, async () => ({ debug: true }))
bus.on(ConfigEvent, async () => ({ port: 8080 }))

const event = bus.dispatch(new ConfigEvent())
const config = await event.eventResultsFlatDict()
// { debug: true, port: 8080 }

// Multiple handlers returning lists - merge them
bus.on(ItemsEvent, async () => [1, 2])
bus.on(ItemsEvent, async () => [3, 4])

const event = bus.dispatch(new ItemsEvent())
const items = await event.eventResultsFlatList()
// [1, 2, 3, 4]

// Get all results
const results = await event.eventResultsList()

// Get results by handler name
const byName = await event.eventResultsByHandlerName()
```

## Event Lifecycle

```typescript
// Check event status
console.log(event.eventStatus) // 'pending' | 'started' | 'completed'

// Check timestamps
console.log(event.eventStartedAt)
console.log(event.eventCompletedAt)

// Check if all handlers and children are complete
if (event.eventIsComplete()) {
  console.log('All done!')
}
```

## Middleware Support

```typescript
const bus = new EventBus({ name: 'MyBus' })

bus.middlewares.push({
  async onEventChange(eventbus, event, status) {
    console.log(`Event ${event.event_type} is now ${status}`)
  },
  async onEventResultChange(eventbus, event, result, status) {
    console.log(`Handler ${result.handler_name} is now ${status}`)
  }
})
```

## API Parity with Python bubus

| Python | TypeScript | Notes |
|--------|------------|-------|
| `class Foo(BaseEvent[str]):` | `class Foo extends BaseEvent<string>` | Same pattern |
| `await event` | `await event.completed` | Use `.completed` in TS |
| `event.event_status` | `event.eventStatus` | camelCase for computed |
| `event.event_result()` | `event.eventResult()` | camelCase for methods |
| `event.event_bus` | `event.eventBus` | Access current bus |
| `bus.dispatch(event)` | `bus.dispatch(event)` | Same API |
| `bus.on(EventType, handler)` | `bus.on(EventType, handler)` | Same API |
| `bus.find(...)` | `bus.find(...)` | Same API |
| `bus.event_is_child_of(...)` | `bus.eventIsChildOf(...)` | camelCase |
| `bus.event_is_parent_of(...)` | `bus.eventIsParentOf(...)` | camelCase |

## JSON Compatibility

Events can be serialized/deserialized for cross-language communication:

```typescript
// TypeScript -> JSON -> Python
const event = new UserCreatedEvent({ user_id: '123', email: 'test@example.com' })
const json = JSON.stringify(event.toJSON())
// Send to Python service...

// Python -> JSON -> TypeScript
const data = JSON.parse(jsonFromPython)
const event = UserCreatedEvent.fromJSON(data)
```

Field names use `snake_case` to match Python exactly for JSON compatibility.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Type check
npm run typecheck
```

## License

MIT
