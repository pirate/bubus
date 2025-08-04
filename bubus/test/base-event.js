// Test BaseEvent directly
import { BaseEvent } from '../dist/event.js';
import { createDeferred } from '../dist/utils.js';

console.log('Testing BaseEvent...');

// Create a simple event
const event = Object.create(BaseEvent.prototype);
event.event_type = 'TestEvent';
event._deferred = createDeferred();

console.log('Event created:', event);
console.log('Event _deferred:', event._deferred);

// Set up promise handler
event._deferred.promise.then(e => {
  console.log('Deferred resolved!', e.event_type);
});

// Use the then method
event.then(e => {
  console.log('Event then resolved!', e.event_type);
});

// Mark as completed
console.log('Marking completed...');
event._markCompleted = BaseEvent.prototype._markCompleted;
event._markCompleted();

setTimeout(() => {
  console.log('Done');
}, 100);