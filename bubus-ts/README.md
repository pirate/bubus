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

// Define a typed event
class UserCreatedEvent extends BaseEvent<string> {
  user_id: string
  email: string

  constructor(data: { user_id: string; email: string }) {
    super({ ...data, event_type: 'UserCreatedEvent' })
    this.user_id = data.user_id
    this.email = data.email
  }
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
  // This child event will have event.event_parent_id set automatically
  const child = bus.dispatch(new ChildEvent())
  return 'parent done'
})
```

## Event Finding

```typescript
// Search history only
const event = await bus.find(ResponseEvent, { past: true, future: false })

// Wait for future event (up to 5 seconds)
const event = await bus.find(ResponseEvent, { past: false, future: 5 })

// Search history and wait for future
const event = await bus.find(ResponseEvent, { past: true, future: 5 })

// With filter
const event = await bus.find(ResponseEvent, {
  where: (e) => e.request_id === myRequestId,
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
```

## API Parity with Python bubus

| Python | TypeScript | Notes |
|--------|------------|-------|
| `class Foo(BaseEvent[str]):` | `class Foo extends BaseEvent<string>` | Same pattern |
| `await event` | `await event` | Both thenable |
| `event.event_status` | `event.eventStatus` | camelCase in TS |
| `event.event_result()` | `event.eventResult()` | camelCase in TS |
| `bus.dispatch(event)` | `bus.dispatch(event)` | Same API |
| `bus.on(EventType, handler)` | `bus.on(EventType, handler)` | Same API |

## JSON Compatibility

Events can be serialized/deserialized for cross-language communication:

```typescript
// TypeScript -> JSON -> Python
const event = new UserCreatedEvent({ user_id: '123', email: 'test@example.com' })
const json = JSON.stringify(event.toJSON())
// Send to Python service...

// Python -> JSON -> TypeScript
const data = JSON.parse(jsonFromPython)
const event = new UserCreatedEvent(data)
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
