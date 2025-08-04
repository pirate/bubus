// Minimal reproduction of the issue
import { createDeferred } from '../dist/utils.js';

async function test() {
  console.log('Creating deferred...');
  const d = createDeferred();
  
  console.log('Setting up then handler...');
  const p = d.promise.then(v => {
    console.log('Promise resolved with:', v);
    return v + ' processed';
  });
  
  console.log('Calling resolve...');
  d.resolve('test value');
  
  console.log('Waiting for promise...');
  try {
    const result = await p;
    console.log('Result:', result);
  } catch (e) {
    console.error('Error:', e);
  }
  
  console.log('Done');
}

test().catch(console.error);