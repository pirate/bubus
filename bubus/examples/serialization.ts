/**
 * Demonstrates serialization compatibility with Python bubus
 */

import { BaseEvent, EventBus, serializeEvent } from '../src/index.js';
import { objectToMap } from '../src/utils.js';

// Event that matches Python structure
class TaskCreatedEvent extends BaseEvent {
  task_id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  
  constructor(data: {
    task_id: string;
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high';
  }) {
    super({ event_type: 'TaskCreated' });
    this.task_id = data.task_id;
    this.title = data.title;
    this.description = data.description;
    this.priority = data.priority;
  }
}

// Simulate receiving a serialized event from Python
const pythonSerializedEvent = {
  "event_type": "TaskCreated",
  "event_id": "01234567-89ab-cdef-0123-456789abcdef",
  "event_schema": "TaskCreated@1.0.0",
  "event_timeout": 60,
  "event_path": ["python_bus"],
  "event_parent_id": null,
  "event_created_at": "2024-01-01T12:00:00.000Z",
  "event_results": {},
  "task_id": "task-123",
  "title": "Implement feature X",
  "description": "Add new functionality for feature X",
  "priority": "high"
};

// Deserialize Python event
function deserializeEvent<T extends BaseEvent>(
  serialized: any,
  EventClass: new (data: any) => T
): T {
  // Extract metadata
  const metadata = {
    event_type: serialized.event_type,
    event_id: serialized.event_id,
    event_schema: serialized.event_schema,
    event_timeout: serialized.event_timeout,
    event_path: serialized.event_path,
    event_parent_id: serialized.event_parent_id,
    event_created_at: serialized.event_created_at,
    event_results: objectToMap(serialized.event_results),
  };
  
  // Extract data fields
  const data: any = {};
  for (const key in serialized) {
    if (!key.startsWith('event_')) {
      data[key] = serialized[key];
    }
  }
  
  // Create event instance
  const event = new EventClass(data);
  
  // Override metadata
  Object.assign(event, metadata);
  
  return event;
}

async function main() {
  const bus = new EventBus('js_bus');
  
  // Register handler
  bus.on(TaskCreatedEvent, async (event) => {
    console.log(`Processing task: ${event.title} (${event.priority})`);
    return {
      processed: true,
      processor: 'js_handler',
      timestamp: new Date().toISOString()
    };
  });
  
  // Deserialize event from Python
  const event = deserializeEvent(pythonSerializedEvent, TaskCreatedEvent);
  console.log('Deserialized event:', event);
  console.log('Event path:', event.event_path);
  
  // Process in JS
  await bus.dispatch(event);
  await event.wait();
  
  // Serialize for sending back to Python
  const serialized = serializeEvent(event);
  console.log('\nSerialized event for Python:');
  console.log(JSON.stringify(serialized, null, 2));
  
  // Example of creating a new event that can be sent to Python
  const newEvent = new TaskCreatedEvent({
    task_id: 'task-456',
    title: 'Review PR',
    description: 'Review and merge pull request #42',
    priority: 'medium'
  });
  
  await bus.dispatch(newEvent);
  await newEvent.wait();
  
  const serializedNew = serializeEvent(newEvent);
  console.log('\nNew event for Python:');
  console.log(JSON.stringify(serializedNew, null, 2));
  
  await bus.stop();
}

main().catch(console.error);