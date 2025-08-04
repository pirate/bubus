// Try to reproduce the node test issue
import { test } from 'node:test';
import { createDeferred } from '../dist/utils.js';

test('Deferred promise in node test', async (t) => {
  console.log('Test started');
  
  const d = createDeferred();
  
  d.promise.then(v => {
    console.log('Promise resolved:', v);
  });
  
  console.log('Resolving...');
  d.resolve('test');
  
  console.log('Awaiting...');
  const result = await d.promise;
  console.log('Await result:', result);
  
  console.log('Test ending');
});