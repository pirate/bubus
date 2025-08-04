import { test } from 'node:test';

function makeDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('Without then method', async (t) => {
  const event = {
    type: 'Test',
    _deferred: makeDeferred(),
    
    // Don't implement then, use wait() instead
    wait() {
      return this._deferred.promise;
    },
    
    complete() {
      console.log('Calling resolve...');
      this._deferred.resolve(this);
    }
  };
  
  console.log('Setting up handler...');
  const p = event.wait().then((e) => {
    console.log('Resolved!', e.type);
    return 'done';
  });
  
  console.log('Completing event...');
  event.complete();
  
  console.log('Awaiting promise...');
  const result = await p;
  console.log('Result:', result);
});

test('With then but not thenable', async (t) => {
  const event = {
    type: 'Test',
    _deferred: makeDeferred(),
    
    // Implement then but with wrong signature
    then() {
      console.log('then called');
      return this._deferred.promise;
    },
    
    complete() {
      console.log('Calling resolve...');
      this._deferred.resolve(this);
    }
  };
  
  console.log('Awaiting directly...');
  event.complete();
  
  // Use the promise directly
  const result = await event._deferred.promise;
  console.log('Result:', result.type);
});