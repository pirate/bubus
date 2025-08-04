# Bubus TypeScript/ESM Implementation

A modern TypeScript implementation of the Python bubus event system, designed for cross-language event serialization and compatible APIs.

## Features

- ✅ **Promise-based async/await** - Natural JavaScript async patterns
- ✅ **Type-safe events** - Full TypeScript support with generics
- ✅ **Python-compatible serialization** - Exchange events between Python and JS
- ✅ **Parent event tracking** - Automatic event genealogy
- ✅ **Flexible handlers** - Support for sync/async, parallel/serial execution
- ✅ **Event forwarding** - Wire multiple buses together
- ✅ **Wildcard handlers** - Listen to all events with `*`
- ✅ **Awaitable events** - `await event` for completion
- ✅ **Zero dependencies** - Only uses `uuidv7` for compatible IDs

## Installation

```bash
npm install bubus
```

## Quick Start

```typescript
import { BaseEvent, EventBus } from 'bubus';

// Define an event
class UserCreatedEvent extends BaseEvent {
  constructor(
    public userId: string,
    public email: string
  ) {
    super({ event_type: 'UserCreated' });
  }
}

// Create bus and register handler
const bus = new EventBus('myapp');

bus.on(UserCreatedEvent, async (event) => {
  console.log(`Welcome ${event.email}!`);
  return { welcomed: true };
});

// Dispatch and wait
const event = new UserCreatedEvent('123', 'user@example.com');
await bus.dispatch(event);
await event.wait(); // Wait for all handlers

// Get results
const result = await event.event_result();
```

## Key Differences from Python

1. **No decorators** - Use class inheritance or factory functions
2. **Native Promises** - No asyncio, just standard JS promises
3. **Event waiting** - Use `await event.wait()` instead of `await event` to avoid thenable issues
4. **Simplified WAL** - No built-in WAL (can be added separately)

## Serialization Compatibility

The event metadata fields match Python exactly:
- `event_type` - Event type identifier
- `event_id` - UUID v7 
- `event_schema` - Version string
- `event_timeout` - Timeout in seconds
- `event_path` - List of bus names
- `event_parent_id` - Parent event UUID
- `event_created_at` - ISO timestamp
- `event_results` - Handler results map

## API Reference

### BaseEvent

Base class for all events. Make events awaitable and tracks metadata.

```typescript
class MyEvent extends BaseEvent {
  constructor(public data: string) {
    super({ event_type: 'MyEvent' });
  }
}
```

### EventBus

Main event dispatcher and handler registry.

```typescript
const bus = new EventBus('name', {
  parallel_handlers: false,  // Run handlers in parallel
  event_timeout: 60         // Default timeout in seconds
});

// Register handlers
bus.on('EventType', handler);
bus.on(EventClass, handler); 
bus.on('*', handler);       // Wildcard
bus.on(/^User/, handler);   // Regex pattern

// Dispatch events
await bus.dispatch(event);

// Control
await bus.wait_until_idle();
await bus.stop(timeout);

// Event forwarding
bus.forward_to(otherBus);

// Wait for specific events
const event = await bus.expect(
  (e): e is MyEvent => e.event_type === 'MyEvent',
  5 // timeout seconds
);
```

## Design Philosophy

This implementation prioritizes:

1. **JS/TS idioms** over Python patterns
2. **Simplicity** over feature completeness  
3. **Type safety** while maintaining flexibility
4. **Cross-language compatibility** for serialization
5. **Modern ESM** and async/await patterns

The goal is ergonomic JS/TS usage while maintaining wire compatibility with Python events.