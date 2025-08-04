/**
 * Basic usage examples for the TypeScript bubus implementation
 */

import { BaseEvent, EventBus, createEventClass } from '../src/index.js';

// Method 1: Class-based events (recommended for type safety)
class UserCreatedEvent extends BaseEvent {
  constructor(
    public userId: string,
    public email: string,
    public name: string
  ) {
    super({ event_type: 'UserCreated' });
  }
}

// Method 2: Factory function for simple events
const OrderPlaced = createEventClass<{
  orderId: string;
  userId: string;
  total: number;
}>('OrderPlaced');

// Create event buses
const userBus = new EventBus('users');
const orderBus = new EventBus('orders', { parallel_handlers: true });

// Register handlers
userBus.on(UserCreatedEvent, async (event) => {
  console.log(`User created: ${event.name} (${event.email})`);
  
  // Dispatch a child event
  const order = new OrderPlaced({
    orderId: 'order-1',
    userId: event.userId,
    total: 0
  });
  
  await orderBus.dispatch(order);
  
  return { processed: true };
});

// String-based registration
userBus.on('UserCreated', async (event: UserCreatedEvent) => {
  console.log(`Sending welcome email to ${event.email}`);
  // Simulate async work
  await new Promise(resolve => setTimeout(resolve, 100));
  return { emailSent: true };
});

// Wildcard handler
userBus.on('*', (event) => {
  console.log(`[Audit] Event: ${event.event_type}, ID: ${event.event_id}`);
});

// Order handlers
orderBus.on(OrderPlaced, async (event) => {
  console.log(`Order ${event.orderId} placed for user ${event.userId}`);
  return { orderId: event.orderId };
});

// Example usage
async function main() {
  // Create and dispatch event
  const userEvent = new UserCreatedEvent(
    'user-123',
    'alice@example.com',
    'Alice Smith'
  );
  
  // Dispatch returns immediately
  const pendingEvent = await userBus.dispatch(userEvent);
  console.log(`Event status: ${pendingEvent.event_status}`); // 'pending' or 'started'
  
  // Wait for completion
  await pendingEvent.wait();
  console.log(`Event status: ${pendingEvent.event_status}`); // 'completed'
  
  // Access results
  const result = await pendingEvent.event_result();
  console.log('First result:', result);
  
  const allResults = await pendingEvent.event_results_list();
  console.log('All results:', allResults);
  
  const resultsByHandler = await pendingEvent.event_results_by_handler_id();
  console.log('Results by handler:', resultsByHandler);
  
  // Event forwarding
  const auditBus = new EventBus('audit');
  auditBus.on('*', (event) => {
    console.log(`[Audit Bus] ${event.event_type} from ${event.event_path.join(' -> ')}`);
  });
  
  // Forward all events from userBus to auditBus
  userBus.forward_to(auditBus);
  
  // Test forwarding
  const forwardEvent = new UserCreatedEvent('user-456', 'bob@example.com', 'Bob Jones');
  await userBus.dispatch(forwardEvent);
  await forwardEvent.wait();
  
  // Wait for a specific event
  const orderPromise = orderBus.expect(
    (event): event is InstanceType<typeof OrderPlaced> => event.event_type === 'OrderPlaced',
    5 // 5 second timeout
  );
  
  // Dispatch an order
  await orderBus.dispatch(new OrderPlaced({
    orderId: 'order-2',
    userId: 'user-789',
    total: 99.99
  }));
  
  const caughtOrder = await orderPromise;
  console.log('Caught order:', caughtOrder.orderId);
  
  // Graceful shutdown
  await userBus.wait_until_idle();
  await orderBus.wait_until_idle();
  await userBus.stop();
  await orderBus.stop();
}

// Run the example
main().catch(console.error);