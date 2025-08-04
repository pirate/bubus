// Check if it's a timing issue with BaseEvent
import { BaseEvent } from '../dist/event.js';

// Simple extension
class TestEvent extends BaseEvent {
  constructor() {
    super({ event_type: 'TestEvent' });
  }
}

async function test() {
  console.log('Creating event...');
  const event = new TestEvent();
  
  console.log('Setting up handlers...');
  
  // Try multiple ways
  const p1 = event.then(() => {
    console.log('then() handler called!');
  });
  
  // Force async
  await Promise.resolve();
  
  console.log('Marking completed...');
  event._markCompleted();
  
  console.log('Waiting explicitly...');
  await new Promise(resolve => setTimeout(resolve, 50));
  
  console.log('Checking promise state...');
  // There's no standard way to check promise state, but we can race it
  const result = await Promise.race([
    p1.then(() => 'resolved'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 10))
  ]);
  
  console.log('Promise state:', result);
}

test().catch(console.error);