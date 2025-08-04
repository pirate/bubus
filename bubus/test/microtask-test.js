// Test microtask scheduling
import { createDeferred } from '../dist/utils.js';

console.log('Start');

const d = createDeferred();

d.promise.then(v => {
  console.log('Handler 1:', v);
});

queueMicrotask(() => {
  console.log('Microtask 1');
});

d.resolve('test');

queueMicrotask(() => {
  console.log('Microtask 2');
});

d.promise.then(v => {
  console.log('Handler 2:', v);
});

Promise.resolve('direct').then(v => {
  console.log('Direct promise:', v);
});

console.log('End of sync code');

// Keep process alive
setTimeout(() => {
  console.log('Timeout');
}, 100);