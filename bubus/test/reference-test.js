// Test if we're losing the promise reference
import { createDeferred } from '../dist/utils.js';

// Simulate what BaseEvent does
class TestClass {
  constructor() {
    this._deferred = createDeferred();
    console.log('Constructor - _deferred:', this._deferred);
    console.log('Constructor - _deferred.resolve:', this._deferred.resolve);
  }
  
  then(onFulfilled, onRejected) {
    return this._deferred.promise.then(onFulfilled, onRejected);
  }
  
  complete() {
    console.log('complete() - _deferred:', this._deferred);
    console.log('complete() - _deferred.resolve:', this._deferred.resolve);
    console.log('complete() - calling resolve...');
    this._deferred.resolve(this);
  }
}

const obj = new TestClass();

console.log('\nSetting up then handler...');
obj.then(() => {
  console.log('THEN HANDLER CALLED!');
});

// Also check the promise directly
obj._deferred.promise.then(() => {
  console.log('DIRECT PROMISE HANDLER CALLED!');
});

console.log('\nCalling complete...');
obj.complete();

setTimeout(() => {
  console.log('\nDone');
}, 100);