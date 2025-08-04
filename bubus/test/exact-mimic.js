// Exactly mimic what our code does
function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve, reject: reject };
}

class TestClass {
  constructor() {
    this._deferred = createDeferred();
  }
  
  then(onFulfilled, onRejected) {
    return this._deferred.promise.then(onFulfilled, onRejected);
  }
  
  complete() {
    this._deferred.resolve(this);
  }
}

// Test 1: Direct usage
console.log('Test 1: Direct usage');
const obj1 = new TestClass();
obj1.then(() => console.log('obj1 resolved!'));
obj1.complete();

// Test 2: With async/await  
async function test2() {
  console.log('\nTest 2: With async/await');
  const obj2 = new TestClass();
  
  const promise = obj2.then(() => {
    console.log('obj2 resolved!');
    return 'done';
  });
  
  obj2.complete();
  
  const result = await promise;
  console.log('Result:', result);
}

test2();

// Test 3: In node test context
import { test } from 'node:test';

test('Node test context', async (t) => {
  console.log('\nTest 3: In node test');
  const obj3 = new TestClass();
  
  const promise = obj3.then(() => {
    console.log('obj3 resolved!');
    return 'done';
  });
  
  obj3.complete();
  
  const result = await promise;
  console.log('Result:', result);
});