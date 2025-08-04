import { test } from 'node:test';

function makeDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('Deferred stored on object', async (t) => {
  // Mimic BaseEvent structure
  const event = {
    type: 'Test',
    _deferred: makeDeferred(),
    
    then(onF, onR) {
      return this._deferred.promise.then(onF, onR);
    },
    
    complete() {
      console.log('Calling resolve...');
      this._deferred.resolve(this);
    }
  };
  
  console.log('Setting up handler...');
  const p = event.then((e) => {
    console.log('Resolved!', e.type);
    return 'done';
  });
  
  console.log('Completing event...');
  event.complete();
  
  console.log('Awaiting promise...');
  const result = await p;
  console.log('Result:', result);
});