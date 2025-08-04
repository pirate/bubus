// Test BaseEvent constructor flow
import { BaseEvent } from '../dist/event.js';

class TestEvent extends BaseEvent {
  constructor() {
    console.log('TestEvent constructor - before super');
    super({ event_type: 'TestEvent' });
    console.log('TestEvent constructor - after super');
    console.log('this._deferred:', this._deferred);
  }
}

console.log('Creating event...');
const event = new TestEvent();

console.log('\nChecking _deferred...');
console.log('_deferred exists:', !!event._deferred);
console.log('_deferred.promise exists:', !!event._deferred.promise);
console.log('_deferred.resolve exists:', !!event._deferred.resolve);
console.log('_deferred.resolve type:', typeof event._deferred.resolve);

console.log('\nTesting resolution...');
let resolved = false;
event.then(() => {
  console.log('EVENT THEN RESOLVED!');
  resolved = true;
});

event._deferred.promise.then(() => {
  console.log('DEFERRED PROMISE RESOLVED!');
});

console.log('Calling _markCompleted...');
event._markCompleted();

console.log('Immediately after markCompleted, resolved =', resolved);

setTimeout(() => {
  console.log('After timeout, resolved =', resolved);
}, 100);