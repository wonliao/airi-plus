import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'

import { createSpeechPipelineRuntime } from '../services/speech/pipeline-runtime'

interface TextRevealBarrier {
  promise: Promise<void>
  resolve: () => void
  settled: boolean
}

export const useSpeechRuntimeStore = defineStore('speech-runtime', () => {
  const runtime = createSpeechPipelineRuntime()
  const textRevealBarriers = new Map<string, TextRevealBarrier>()

  function openIntent(options?: Parameters<typeof runtime.openIntent>[0]) {
    return runtime.openIntent(options)
  }

  async function registerHost(pipeline: Parameters<typeof runtime.registerHost>[0]) {
    await runtime.registerHost(pipeline)
  }

  function isHost() {
    return runtime.isHost()
  }

  function createTextRevealBarrier() {
    const token = `speech-reveal-${nanoid()}`

    let resolveBarrier = () => {}
    const promise = new Promise<void>((resolve) => {
      resolveBarrier = resolve
    })

    textRevealBarriers.set(token, {
      promise,
      resolve: () => {
        const barrier = textRevealBarriers.get(token)
        if (!barrier || barrier.settled)
          return

        barrier.settled = true
        textRevealBarriers.delete(token)
        resolveBarrier()
      },
      settled: false,
    })

    return { token }
  }

  async function waitForTextRevealBarrier(token: string, timeoutMs = 8000) {
    const barrier = textRevealBarriers.get(token)
    if (!barrier)
      return

    await Promise.race([
      barrier.promise,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolveTextRevealBarrier(token)
          resolve()
        }, timeoutMs)
      }),
    ])
  }

  function resolveTextRevealBarrier(token: string) {
    textRevealBarriers.get(token)?.resolve()
  }

  function resolveNextTextRevealBarrier() {
    const [token] = textRevealBarriers.keys()
    if (!token)
      return

    resolveTextRevealBarrier(token)
  }

  async function dispose() {
    await runtime.dispose()
    for (const barrier of textRevealBarriers.values()) {
      barrier.resolve()
    }
    textRevealBarriers.clear()
  }

  return {
    openIntent,
    registerHost,
    isHost,
    createTextRevealBarrier,
    waitForTextRevealBarrier,
    resolveTextRevealBarrier,
    resolveNextTextRevealBarrier,
    dispose,
  }
})
