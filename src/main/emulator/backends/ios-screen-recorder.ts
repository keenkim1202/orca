import {
  EmulatorRecordingRegistry,
  type EmulatorRecordingInfo
} from '../emulator-recording-registry'
import { startSimctlVideoRecording } from '../simctl-video-recording'
import type { StartVideoRecording } from '../emulator-bridge-types'

// Owns the iOS backend's screen-recording state so the backend stays a thin
// delegate: one `simctl io recordVideo` process per simulator, keyed by udid.
export class IosScreenRecorder {
  private readonly recordings = new EmulatorRecordingRegistry()

  constructor(
    private readonly startVideoRecording: StartVideoRecording = startSimctlVideoRecording
  ) {}

  async start(udid: string, outputPath: string): Promise<EmulatorRecordingInfo> {
    return this.recordings.start(udid, () => this.startVideoRecording(udid, outputPath))
  }

  async stop(udid: string): Promise<EmulatorRecordingInfo> {
    return this.recordings.stop(udid)
  }

  get(udid: string): EmulatorRecordingInfo | null {
    return this.recordings.get(udid)
  }

  async stopIfRunning(udid: string): Promise<void> {
    await this.recordings.stopIfRunning(udid)
  }

  async stopAll(): Promise<void> {
    await this.recordings.stopAll()
  }
}
