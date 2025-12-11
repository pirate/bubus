/**
 * Tests for EventBus name conflict resolution.
 * Translated from Python tests/test_name_conflict_gc.py
 * Note: JavaScript doesn't have explicit GC control like Python,
 * but we test the name conflict detection and unique name generation.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventBus } from '../src/index.js'

// =============================================================================
// Tests
// =============================================================================

describe('NameConflict', () => {
  afterEach(() => {
    // Clean up any remaining buses
    EventBus.allInstances.clear()
  })

  describe('name conflict with live reference', () => {
    it('should warn and auto-generate unique name when conflict detected', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const bus1 = new EventBus({ name: 'GCTestConflict' })

      // Try to create another with the same name
      const bus2 = new EventBus({ name: 'GCTestConflict' })

      // Should have warned about the conflict
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('GCTestConflict')
      )

      // The second bus should have a unique name
      expect(bus2.name).not.toBe('GCTestConflict')
      expect(bus2.name.startsWith('GCTestConflict_')).toBe(true)

      await bus1.stop()
      await bus2.stop()
      consoleWarnSpy.mockRestore()
    })
  })

  describe('name available after stop and clear', () => {
    it('should allow reusing name after bus is stopped with clear', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const bus1 = new EventBus({ name: 'GCStopClear' })

      // Stop and clear it
      await bus1.stop({ clear: true })

      // Now should be able to create new one with same name without warning
      const warnCallsBefore = consoleWarnSpy.mock.calls.length
      const bus2 = new EventBus({ name: 'GCStopClear' })
      const warnCallsAfter = consoleWarnSpy.mock.calls.length

      expect(bus2.name).toBe('GCStopClear')
      // Should not have new warnings about name conflict
      expect(warnCallsAfter).toBe(warnCallsBefore)

      await bus2.stop()
      consoleWarnSpy.mockRestore()
    })
  })

  describe('multiple buses with some removed', () => {
    it('should allow names of removed buses to be reused', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const bus1 = new EventBus({ name: 'GCMulti1' })
      const bus2 = new EventBus({ name: 'GCMulti2' })
      const bus3 = new EventBus({ name: 'GCMulti3' })

      // Stop and clear bus2
      await bus2.stop({ clear: true })

      // Should be able to create new bus with GCMulti2 name
      const warnCallsBefore = consoleWarnSpy.mock.calls.length
      const bus2_new = new EventBus({ name: 'GCMulti2' })
      expect(bus2_new.name).toBe('GCMulti2')
      expect(consoleWarnSpy.mock.calls.length).toBe(warnCallsBefore)

      // But creating with GCMulti1 or GCMulti3 should warn
      const bus1_conflict = new EventBus({ name: 'GCMulti1' })
      expect(bus1_conflict.name.startsWith('GCMulti1_')).toBe(true)

      const bus3_conflict = new EventBus({ name: 'GCMulti3' })
      expect(bus3_conflict.name.startsWith('GCMulti3_')).toBe(true)

      await bus1.stop()
      await bus2_new.stop()
      await bus3.stop()
      await bus1_conflict.stop()
      await bus3_conflict.stop()
      consoleWarnSpy.mockRestore()
    })
  })

  describe('all instances tracking', () => {
    it('should track all EventBus instances', async () => {
      const initialCount = EventBus.allInstances.size

      const bus1 = new EventBus({ name: 'TrackTest1' })
      const bus2 = new EventBus({ name: 'TrackTest2' })
      const bus3 = new EventBus({ name: 'TrackTest3' })

      expect(EventBus.allInstances.size).toBe(initialCount + 3)

      // Stop and clear one
      await bus2.stop({ clear: true })

      expect(EventBus.allInstances.size).toBe(initialCount + 2)

      // Verify remaining buses are tracked
      const names = Array.from(EventBus.allInstances).map((b) => b.name)
      expect(names).toContain('TrackTest1')
      expect(names).not.toContain('TrackTest2')
      expect(names).toContain('TrackTest3')

      await bus1.stop({ clear: true })
      await bus3.stop({ clear: true })
    })
  })

  describe('concurrent name creation', () => {
    it('should generate unique names for concurrent creation with same name', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const bus1 = new EventBus({ name: 'ConcurrentTest' })
      const bus2 = new EventBus({ name: 'ConcurrentTest' })
      const bus3 = new EventBus({ name: 'ConcurrentTest' })

      // All should have different names
      const names = [bus1.name, bus2.name, bus3.name]
      const uniqueNames = new Set(names)

      expect(uniqueNames.size).toBe(3)
      expect(bus1.name).toBe('ConcurrentTest')
      expect(bus2.name.startsWith('ConcurrentTest_')).toBe(true)
      expect(bus3.name.startsWith('ConcurrentTest_')).toBe(true)

      await bus1.stop()
      await bus2.stop()
      await bus3.stop()
      consoleWarnSpy.mockRestore()
    })
  })

  describe('unique suffix generation', () => {
    it('should generate sufficiently unique names', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const buses: EventBus[] = []
      const names = new Set<string>()

      // Create many buses with the same base name
      for (let i = 0; i < 10; i++) {
        const bus = new EventBus({ name: 'UniqueSuffixTest' })
        buses.push(bus)
        names.add(bus.name)
      }

      // All should have unique names
      expect(names.size).toBe(10)

      // First should be exact, rest should have suffixes
      expect(buses[0].name).toBe('UniqueSuffixTest')
      for (let i = 1; i < 10; i++) {
        expect(buses[i].name.startsWith('UniqueSuffixTest_')).toBe(true)
      }

      for (const bus of buses) {
        await bus.stop()
      }
      consoleWarnSpy.mockRestore()
    })
  })
})
