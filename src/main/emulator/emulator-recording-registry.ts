import { EmulatorError } from './emulator-errors'

// One in-flight screen recording per device, keyed by resolved device id. Owned
// by the backend that spawned it so helper teardown and app quit can stop
// recordings instead of orphaning the capture process.

export type EmulatorRecording = {
  outputPath: string
  stop(): Promise<void>
}

export type EmulatorRecordingInfo = {
  deviceId: string
  outputPath: string
  startedAt: number
}

type RegistryEntry = {
  recording: EmulatorRecording
  startedAt: number
}

export class EmulatorRecordingRegistry {
  private readonly entries = new Map<string, RegistryEntry>()
  // A start that is still spawning, and a stop that is still writing the file,
  // both hold the device without an entry. Without this a second start would
  // pass the entry check and spawn a capture into the same path.
  private readonly reserved = new Set<string>()

  constructor(private readonly now: () => number = Date.now) {}

  has(deviceId: string): boolean {
    return this.entries.has(deviceId) || this.reserved.has(deviceId)
  }

  get(deviceId: string): EmulatorRecordingInfo | null {
    const entry = this.entries.get(deviceId)
    if (!entry) {
      return null
    }
    return { deviceId, outputPath: entry.recording.outputPath, startedAt: entry.startedAt }
  }

  list(): EmulatorRecordingInfo[] {
    return [...this.entries.entries()].map(([deviceId, entry]) => ({
      deviceId,
      outputPath: entry.recording.outputPath,
      startedAt: entry.startedAt
    }))
  }

  // The device stays reserved for the whole of `begin`, so two concurrent starts
  // cannot both spawn a capture process for it.
  async start(
    deviceId: string,
    begin: () => Promise<EmulatorRecording>
  ): Promise<EmulatorRecordingInfo> {
    if (this.has(deviceId)) {
      throw new EmulatorError(
        'emulator_error',
        `A screen recording is already running for ${deviceId}. Stop it before starting another.`
      )
    }
    this.reserved.add(deviceId)
    try {
      const recording = await begin()
      const startedAt = this.now()
      this.entries.set(deviceId, { recording, startedAt })
      return { deviceId, outputPath: recording.outputPath, startedAt }
    } finally {
      this.reserved.delete(deviceId)
    }
  }

  // Reserved rather than kept: a failed stop must not wedge the device into a
  // permanent "already recording" state, but a new start must not overwrite the
  // file this one is still writing.
  async stop(deviceId: string): Promise<EmulatorRecordingInfo> {
    const entry = this.entries.get(deviceId)
    if (!entry) {
      throw new EmulatorError(
        'emulator_no_active',
        `No screen recording is running for ${deviceId}.`
      )
    }
    this.entries.delete(deviceId)
    this.reserved.add(deviceId)
    try {
      await entry.recording.stop()
    } finally {
      this.reserved.delete(deviceId)
    }
    return { deviceId, outputPath: entry.recording.outputPath, startedAt: entry.startedAt }
  }

  async stopIfRunning(deviceId: string): Promise<void> {
    if (this.entries.has(deviceId)) {
      await this.stop(deviceId).catch(() => {})
    }
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.entries.keys()].map((id) => this.stopIfRunning(id)))
  }
}
