// Trace the resolve call
import { BaseEvent } from '../dist/event.js';

class TestEvent extends BaseEvent {
  constructor() {
    super({ event_type: 'TestEvent' });
    
    // Wrap the resolve function to trace calls
    const originalResolve = this._deferred.resolve;
    this._deferred.resolve = (value) => {
      console.log('RESOLVE CALLED with:', value);
      console.log('originalResolve:', originalResolve);
      console.log('Calling original resolve...');
      const result = originalResolve(value);
      console.log('Original resolve returned:', result);
      return result;
    };
  }
}

const event = new TestEvent();

event.then((e) => {
  console.log('THEN RESOLVED:', e.event_type);
});

console.log('About to call _markCompleted...');
event._markCompleted();

setTimeout(() => {
  console.log('Done');
}, 100);