// Test the actual createDeferred from utils
import { createDeferred } from '../dist/utils.js';

console.log('createDeferred:', createDeferred);
console.log('createDeferred.toString():', createDeferred.toString());

const d = createDeferred();
console.log('Created deferred:', d);

d.promise.then(v => {
  console.log('RESOLVED:', v);
}).catch(e => {
  console.error('ERROR:', e);
});

console.log('Calling resolve...');
try {
  d.resolve('test');
  console.log('Resolve called successfully');
} catch (e) {
  console.error('Resolve error:', e);
}

// Also test with await
(async () => {
  const d2 = createDeferred();
  setTimeout(() => {
    console.log('Delayed resolve...');
    d2.resolve('delayed');
  }, 10);
  
  const result = await d2.promise;
  console.log('Awaited result:', result);
})();

setTimeout(() => {
  console.log('Final check');
}, 100);