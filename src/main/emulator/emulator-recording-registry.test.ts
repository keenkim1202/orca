import { describe, expect, it, vi } from 'vitest'
import { EmulatorRecordingRegistry } from './emulator-recording-registry'

function fakeRecording(outputPath = '/tmp/demo.mp4', stop = vi.fn(async () => {})) {
  return { outputPath, stop }
}

function start(registry: EmulatorRecordingRegistry, deviceId: string, recording = fakeRecording()) {
  return registry.start(deviceId, async () => recording)
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('EmulatorRecordingRegistry', () => {
  it('rejects a second recording for the same device', async () => {
    const registry = new EmulatorRecordingRegistry(() => 1_000)
    await start(registry, 'UDID-1')

    await expect(start(registry, 'UDID-1')).rejects.toThrowError(/already running for UDID-1/)
  })

  it('rejects a second start while the first is still spawning', async () => {
    const registry = new EmulatorRecordingRegistry()
    const spawning = deferred<ReturnType<typeof fakeRecording>>()
    const first = registry.start('UDID-1', () => spawning.promise)

    await expect(start(registry, 'UDID-1')).rejects.toThrowError(/already running for UDID-1/)

    spawning.resolve(fakeRecording())
    await expect(first).resolves.toMatchObject({ deviceId: 'UDID-1' })
  })

  it('frees the device when the spawn itself fails', async () => {
    const registry = new EmulatorRecordingRegistry()

    await expect(
      registry.start('UDID-1', async () => {
        throw new Error('xcrun missing')
      })
    ).rejects.toThrow('xcrun missing')
    await expect(start(registry, 'UDID-1')).resolves.toMatchObject({ deviceId: 'UDID-1' })
  })

  it('tracks recordings per device independently', async () => {
    const registry = new EmulatorRecordingRegistry(() => 1_000)
    await start(registry, 'UDID-1', fakeRecording('/tmp/one.mp4'))
    await start(registry, 'UDID-2', fakeRecording('/tmp/two.mp4'))

    expect(registry.get('UDID-1')).toEqual({
      deviceId: 'UDID-1',
      outputPath: '/tmp/one.mp4',
      startedAt: 1_000
    })
    expect(registry.list()).toHaveLength(2)
  })

  it('rejects stopping a device that is not recording', async () => {
    const registry = new EmulatorRecordingRegistry()

    await expect(registry.stop('UDID-1')).rejects.toMatchObject({ code: 'emulator_no_active' })
  })

  it('keeps the device reserved while the stop is still writing the file', async () => {
    const registry = new EmulatorRecordingRegistry()
    const writing = deferred<void>()
    await start(
      registry,
      'UDID-1',
      fakeRecording(
        '/tmp/demo.mp4',
        vi.fn(() => writing.promise)
      )
    )
    const stopping = registry.stop('UDID-1')

    await expect(start(registry, 'UDID-1')).rejects.toThrowError(/already running for UDID-1/)

    writing.resolve()
    await stopping
    await expect(start(registry, 'UDID-1')).resolves.toMatchObject({ deviceId: 'UDID-1' })
  })

  it('frees the device even when stopping throws, so a retry can start again', async () => {
    const registry = new EmulatorRecordingRegistry()
    const stop = vi.fn(async () => {
      throw new Error('mux failed')
    })
    await start(registry, 'UDID-1', fakeRecording('/tmp/demo.mp4', stop))

    await expect(registry.stop('UDID-1')).rejects.toThrow('mux failed')
    expect(registry.has('UDID-1')).toBe(false)
    await expect(start(registry, 'UDID-1')).resolves.toMatchObject({ deviceId: 'UDID-1' })
  })

  it('stopIfRunning swallows failures and is a no-op when idle', async () => {
    const registry = new EmulatorRecordingRegistry()
    const stop = vi.fn(async () => {
      throw new Error('mux failed')
    })
    await start(registry, 'UDID-1', fakeRecording('/tmp/demo.mp4', stop))

    await expect(registry.stopIfRunning('UDID-1')).resolves.toBeUndefined()
    await expect(registry.stopIfRunning('UDID-1')).resolves.toBeUndefined()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('stops every tracked recording on shutdown', async () => {
    const registry = new EmulatorRecordingRegistry()
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    await start(registry, 'UDID-1', fakeRecording('/tmp/one.mp4', first))
    await start(registry, 'UDID-2', fakeRecording('/tmp/two.mp4', second))

    await registry.stopAll()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(registry.list()).toEqual([])
  })
})
