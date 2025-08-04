import { test } from 'node:test';

test('Circular reference in thenable', async (t) => {
  let resolveFunc;
  const promise = new Promise(r => { resolveFunc = r; });
  
  const obj = {
    name: 'TestObj',
    promise: promise,
    
    then(onF, onR) {
      return this.promise.then(onF, onR);
    },
    
    complete() {
      // Resolve with self - circular reference!
      resolveFunc(this);
    }
  };
  
  console.log('Setting up...');
  const p = obj.then(result => {
    console.log('Got result:', result.name);
    return 'done';
  });
  
  console.log('Completing...');
  obj.complete();
  
  console.log('Awaiting...');
  const final = await p;
  console.log('Final:', final);
});