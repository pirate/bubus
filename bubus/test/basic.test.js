import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { BaseEvent, EventBus, createEventClass } from '../dist/index.js';

test('Basic event dispatch and handling', async () => {
  const bus = new EventBus('test');
  
  class TestEvent extends BaseEvent {
    constructor(message) {
      super({ event_type: 'TestEvent' });
      this.message = message;
    }
  }
  
  let handlerCalled = false;
  bus.on(TestEvent, async (event) => {
    handlerCalled = true;
    assert.equal(event.message, 'Hello');
    return { processed: true };
  });
  
  const event = new TestEvent('Hello');
  await bus.dispatch(event);
  await event.wait();
  
  assert(handlerCalled);
  assert.equal(event.event_status, 'completed');
  
  const result = await event.event_result();
  assert.deepEqual(result, { processed: true });
  
  await bus.stop();
});

test('Multiple handlers and results', async () => {
  const bus = new EventBus('test');
  
  const SimpleEvent = createEventClass('SimpleEvent');
  
  bus.on('SimpleEvent', async () => ({ handler: 1 }));
  bus.on('SimpleEvent', async () => ({ handler: 2 }));
  bus.on('SimpleEvent', async () => ({ handler: 3 }));
  
  const event = new SimpleEvent({ value: 42 });
  await bus.dispatch(event);
  await event.wait();
  
  const results = await event.event_results_list();
  assert.equal(results.length, 3);
  assert(results.some(r => r.handler === 1));
  assert(results.some(r => r.handler === 2));
  assert(results.some(r => r.handler === 3));
  
  await bus.stop();
});

test('Parent event tracking', async () => {
  const bus = new EventBus('test');
  
  class ParentEvent extends BaseEvent {
    constructor() {
      super({ event_type: 'ParentEvent' });
    }
  }
  
  class ChildEvent extends BaseEvent {
    constructor() {
      super({ event_type: 'ChildEvent' });
    }
  }
  
  bus.on(ParentEvent, async () => {
    const child = new ChildEvent();
    await bus.dispatch(child);
    return child.event_id;
  });
  
  let childParentId;
  bus.on(ChildEvent, async (event) => {
    childParentId = event.event_parent_id;
  });
  
  const parent = new ParentEvent();
  await bus.dispatch(parent);
  await parent.wait();
  
  const childId = await parent.event_result();
  assert(childParentId);
  assert.equal(childParentId, parent.event_id);
  
  await bus.stop();
});

test('Error handling', async () => {
  const bus = new EventBus('test');
  
  class ErrorEvent extends BaseEvent {
    constructor() {
      super({ event_type: 'ErrorEvent' });
    }
  }
  
  bus.on(ErrorEvent, async () => {
    throw new Error('Handler failed');
  });
  
  bus.on(ErrorEvent, async () => {
    return { success: true };
  });
  
  const event = new ErrorEvent();
  await bus.dispatch(event);
  await event.wait();
  
  const results = Array.from(event.event_results.values());
  assert.equal(results.length, 2);
  
  const errorResult = results.find(r => r.status === 'error');
  const successResult = results.find(r => r.status === 'completed');
  
  assert(errorResult);
  assert(successResult);
  assert.equal(errorResult.error, 'Handler failed');
  assert.deepEqual(successResult.result, { success: true });
  
  await bus.stop();
});

test('Wildcard handlers', async () => {
  const bus = new EventBus('test');
  
  const events = [];
  bus.on('*', (event) => {
    events.push(event.event_type);
  });
  
  class EventA extends BaseEvent {
    constructor() {
      super({ event_type: 'EventA' });
    }
  }
  
  class EventB extends BaseEvent {
    constructor() {
      super({ event_type: 'EventB' });
    }
  }
  
  await bus.dispatch(new EventA());
  await bus.dispatch(new EventB());
  
  await bus.wait_until_idle();
  
  assert.deepEqual(events, ['EventA', 'EventB']);
  
  await bus.stop();
});

test('Event forwarding', async () => {
  const bus1 = new EventBus('bus1');
  const bus2 = new EventBus('bus2');
  
  bus1.forward_to(bus2);
  
  let receivedInBus2 = false;
  bus2.on('TestEvent', () => {
    receivedInBus2 = true;
  });
  
  class TestEvent extends BaseEvent {
    constructor() {
      super({ event_type: 'TestEvent' });
    }
  }
  
  const event = new TestEvent();
  await bus1.dispatch(event);
  await event.wait();
  
  assert(receivedInBus2);
  assert.deepEqual(event.event_path, ['bus1', 'bus2']);
  
  await bus1.stop();
  await bus2.stop();
});