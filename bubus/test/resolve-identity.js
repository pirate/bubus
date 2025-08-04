// Check if resolve is the right function
import { createDeferred } from '../dist/utils.js';

const d = createDeferred();

// Save the original resolve
let capturedResolve;
const testPromise = new Promise(r => {
  capturedResolve = r;
});

console.log('d.resolve === capturedResolve:', d.resolve === capturedResolve);
console.log('d.resolve:', d.resolve);
console.log('typeof d.resolve:', typeof d.resolve);

// Test if calling it works
console.log('\nDirect test of d.resolve:');
try {
  console.log('Result of d.resolve("test"):', d.resolve('test'));
} catch (e) {
  console.error('Error:', e);
}

// Check the promise
d.promise.then(v => {
  console.log('Promise resolved with:', v);
}).catch(e => {
  console.error('Promise rejected with:', e);
});

// Let's also check Promise.resolve behavior
console.log('\nTesting Promise.resolve:');
const p2 = Promise.resolve('direct');
p2.then(v => console.log('Promise.resolve value:', v));

setTimeout(() => {
  console.log('\nFinal state');
  // Try to inspect the promise (non-standard)
  console.log('d.promise:', d.promise);
}, 100);