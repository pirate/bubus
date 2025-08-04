import { test } from 'node:test';

console.log('Outside test:');
const obj1 = {
  then(onF) {
    console.log('then called on obj1');
    return Promise.resolve('obj1').then(onF);
  }
};

// This should trigger then
Promise.resolve(obj1).then(v => console.log('Got:', v));

test('Thenable in test context', async (t) => {
  console.log('\nInside test:');
  
  const obj2 = {
    value: 'obj2',
    then(onF, onR) {
      console.log('then called on obj2');
      return Promise.resolve(this.value).then(onF, onR);
    }
  };
  
  // Try to use it
  console.log('Using obj2...');
  const result = await obj2;
  console.log('Result:', result);
});

test('Our exact pattern', async (t) => {
  let resolveFunc;
  const internalPromise = new Promise(r => { resolveFunc = r; });
  
  const obj = {
    data: 'mydata',
    then(onF, onR) {
      console.log('then called with:', typeof onF, typeof onR);
      return internalPromise.then(onF, onR);
    }
  };
  
  // Set up handler
  const p = obj.then(v => {
    console.log('Handler got:', v);
    return v + ' processed';
  });
  
  // Resolve
  console.log('Resolving...');
  resolveFunc(obj.data);
  
  // Wait
  const result = await p;
  console.log('Final result:', result);
});