import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'

export type EmulatorRecordingStatus = 'idle' | 'starting' | 'recording' | 'stopping'

type RecordingInfo = { deviceId: string; outputPath: string; startedAt: number }

export function useEmulatorScreenRecording(
  worktreeId: string,
  deviceName: string,
  isLive: boolean
) {
  const [status, setStatus] = useState<EmulatorRecordingStatus>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const startedAtRef = useRef(0)
  // The device that is actually recording, so Stop targets it even if the pane
  // has since switched the worktree's active device.
  const recordingDeviceRef = useRef<string | null>(null)
  // Bumped whenever the stream flips, so an in-flight start that lands after a
  // device switch cannot report itself as the current recording.
  const generationRef = useRef(0)
  const statusRef = useRef(status)
  statusRef.current = status

  useEffect(() => {
    if (status !== 'recording') {
      return
    }
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 1_000)
    return () => clearInterval(timer)
  }, [status])

  // A dropped stream means the capture process is gone too; don't strand the button.
  // Adjusted during render, not in an effect, so the stale status never paints.
  const [wasLive, setWasLive] = useState(isLive)
  if (wasLive !== isLive) {
    setWasLive(isLive)
    generationRef.current += 1
    if (!isLive) {
      recordingDeviceRef.current = null
      setStatus('idle')
      setElapsedSeconds(0)
    }
  }

  // The capture is backend state, so a pane remount, a second pane, or
  // `orca emulator record start` must be read back instead of assumed idle.
  useEffect(() => {
    if (!isLive) {
      return
    }
    let cancelled = false
    void callRuntimeRpc({ kind: 'local' }, 'emulator.recordStatus', { worktree: worktreeId })
      .then((result) => {
        const info = readRecordingInfo(result)
        if (cancelled || !info || statusRef.current !== 'idle') {
          return
        }
        recordingDeviceRef.current = info.deviceId
        startedAtRef.current = info.startedAt
        setElapsedSeconds(Math.floor((Date.now() - info.startedAt) / 1000))
        setStatus('recording')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isLive, worktreeId])

  const start = useCallback(async () => {
    const generation = generationRef.current
    setStatus('starting')
    try {
      const result = await callRuntimeRpc({ kind: 'local' }, 'emulator.recordStart', {
        name: deviceName,
        worktree: worktreeId
      })
      if (generationRef.current !== generation) {
        return
      }
      recordingDeviceRef.current = readRecordingInfo(result)?.deviceId ?? null
      startedAtRef.current = Date.now()
      setElapsedSeconds(0)
      setStatus('recording')
    } catch (error) {
      if (generationRef.current !== generation) {
        return
      }
      setStatus('idle')
      toast.error(
        translate(
          'auto.components.emulator.pane.use.emulator.screen.recording.9c7e2a1d40',
          'Could not start screen recording'
        ),
        { description: errorDescription(error) }
      )
    }
  }, [deviceName, worktreeId])

  const stop = useCallback(async () => {
    setStatus('stopping')
    try {
      const result = await callRuntimeRpc({ kind: 'local' }, 'emulator.recordStop', {
        device: recordingDeviceRef.current ?? undefined,
        worktree: worktreeId
      })
      recordingDeviceRef.current = null
      setStatus('idle')
      setElapsedSeconds(0)
      showSavedToast(readRecordingInfo(result)?.outputPath)
    } catch (error) {
      recordingDeviceRef.current = null
      setStatus('idle')
      setElapsedSeconds(0)
      toast.error(
        translate(
          'auto.components.emulator.pane.use.emulator.screen.recording.4b1f0c88ea',
          'Could not save screen recording'
        ),
        { description: errorDescription(error) }
      )
    }
  }, [worktreeId])

  const toggle = useCallback(() => {
    if (status === 'recording') {
      void stop()
      return
    }
    if (status === 'idle') {
      void start()
    }
  }, [start, status, stop])

  return { status, elapsedSeconds, toggle }
}

function showSavedToast(outputPath?: string): void {
  const title = translate(
    'auto.components.emulator.pane.use.emulator.screen.recording.7d3a5b2c19',
    'Screen recording saved'
  )
  if (!outputPath) {
    toast.success(title)
    return
  }
  toast.success(title, {
    description: outputPath,
    action: {
      label: translate(
        'auto.components.emulator.pane.use.emulator.screen.recording.2e6f9a0b77',
        'Open'
      ),
      onClick: () => void window.api.shell.openPath(outputPath)
    }
  })
}

function readRecordingInfo(value: unknown): RecordingInfo | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  if (!('deviceId' in value) || !('outputPath' in value) || !('startedAt' in value)) {
    return null
  }
  const { deviceId, outputPath, startedAt } = value
  if (
    typeof deviceId !== 'string' ||
    typeof outputPath !== 'string' ||
    typeof startedAt !== 'number'
  ) {
    return null
  }
  return { deviceId, outputPath, startedAt }
}

function errorDescription(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined
}

export function formatRecordingElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
