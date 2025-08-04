import { test } from 'node:test';
import { BaseEvent, EventBus } from '../dist/index.js';

test('Trace full flow', async (t) => {
  console.log('=== Test start ===');
  
  const bus = new EventBus('test');
  
  // Patch methods to trace
  const origProcess = bus.processQueue;
  bus.processQueue = async function() {
    console.log('>> processQueue start');
    await origProcess.call(this);
    console.log('>> processQueue end');
  };
  
  const origProcessEvent = bus.processEvent;
  bus.processEvent = async function(event) {
    console.log('>> processEvent start:', event.event_type);
    await origProcessEvent.call(this, event);
    console.log('>> processEvent end:', event.event_type);
  };
  
  class TestEvent extends BaseEvent {
    constructor() {
      super({ event_type: 'TestEvent' });
      console.log('>> TestEvent constructed');
    }
  }
  
  // Patch _markCompleted
  const origMark = BaseEvent.prototype._markCompleted;
  BaseEvent.prototype._markCompleted = function() {
    console.log('>> _markCompleted called on', this.event_type);
    console.log('   _deferred before:', this._deferred);
    origMark.call(this);
    console.log('   _deferred after:', this._deferred);
  };
  
  bus.on(TestEvent, async (event) => {
    console.log('>> Handler called');
    return { ok: true };
  });
  
  const event = new TestEvent();
  
  // Set up promise handler BEFORE dispatch
  const eventPromise = event.then((e) => {
    console.log('>> Event promise resolved!', e.event_type);
    return e;
  });
  
  console.log('>> Dispatching...');
  await bus.dispatch(event);
  
  console.log('>> Dispatch complete, waiting for event...');
  await eventPromise;
  
  console.log('>> Event complete');
  await bus.stop();
  console.log('=== Test end ===');
});