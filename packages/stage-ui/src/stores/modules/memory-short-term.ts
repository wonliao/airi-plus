import type { MemoryValidationStatus } from './memory-shared'

import { errorMessageFrom } from '@moeru/std'
import { isUrl } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

const mem0ConnectivityTimeoutMsec = 5_000

interface Mem0ProbeCandidate {
  kind: 'health' | 'models'
  url: URL
}

function toDirectoryUrl(baseUrl: URL) {
  return new URL(baseUrl.toString().endsWith('/') ? baseUrl.toString() : `${baseUrl.toString()}/`)
}

function resolveMem0ProbeCandidates(baseUrl: URL) {
  const directoryUrl = toDirectoryUrl(baseUrl)
  const candidates: Mem0ProbeCandidate[] = [
    { kind: 'health', url: new URL('health', directoryUrl) },
    { kind: 'health', url: new URL('healthz', directoryUrl) },
  ]

  if (baseUrl.pathname.endsWith('/v1') || baseUrl.pathname.endsWith('/v1/')) {
    candidates.push({ kind: 'health', url: new URL('../healthz', directoryUrl) })
    candidates.push({ kind: 'health', url: new URL('../health', directoryUrl) })
    candidates.push({ kind: 'models', url: new URL('models', directoryUrl) })
  }

  return [...new Map(candidates.map(candidate => [candidate.url.toString(), candidate])).values()]
}

async function pingMem0Endpoint(baseUrl: URL, apiKey: string) {
  const candidates = resolveMem0ProbeCandidates(baseUrl)
  let lastFailureReason = ''

  for (const candidate of candidates) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), mem0ConnectivityTimeoutMsec)

    try {
      const response = await fetch(candidate.url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: controller.signal,
      })

      if ((response.status >= 200 && response.status < 300) || response.status === 401 || response.status === 403) {
        return {
          ok: true,
          probeUrl: candidate.url.toString(),
          status: response.status,
        }
      }

      if (response.status === 404) {
        lastFailureReason = `${candidate.kind} probe returned HTTP 404`
        continue
      }

      lastFailureReason = `HTTP ${response.status} ${response.statusText}`.trim()
    }
    catch (error) {
      lastFailureReason = errorMessageFrom(error) ?? 'Unknown error.'
    }
    finally {
      clearTimeout(timeout)
    }
  }

  return {
    ok: false,
    reason: lastFailureReason || 'No mem0 probe endpoint responded successfully.',
  }
}

export const useShortTermMemoryStore = defineStore('memory-short-term', () => {
  const enabled = useLocalStorageManualReset<boolean>('settings/memory/short-term/enabled', false)
  const backendId = useLocalStorageManualReset<string>('settings/memory/short-term/backend-id', 'mem0')
  const validationStatus = useLocalStorageManualReset<MemoryValidationStatus>('settings/memory/short-term/validation-status', 'idle')
  const lastValidation = useLocalStorageManualReset<string>('settings/memory/short-term/last-validation', '')

  const mode = useLocalStorageManualReset<string>('settings/memory/short-term/mode', 'open-source')
  const userId = useLocalStorageManualReset<string>('settings/memory/short-term/user-id', '')
  const baseUrl = useLocalStorageManualReset<string>('settings/memory/short-term/base-url', '')
  const apiKey = useLocalStorageManualReset<string>('settings/memory/short-term/api-key', '')
  const embedder = useLocalStorageManualReset<string>('settings/memory/short-term/embedder', '')
  const vectorStore = useLocalStorageManualReset<string>('settings/memory/short-term/vector-store', '')
  const autoRecall = useLocalStorageManualReset<boolean>('settings/memory/short-term/auto-recall', true)
  const autoCapture = useLocalStorageManualReset<boolean>('settings/memory/short-term/auto-capture', false)
  const topK = useLocalStorageManualReset<number>('settings/memory/short-term/top-k', 5)
  const searchThreshold = useLocalStorageManualReset<number>('settings/memory/short-term/search-threshold', 0.6)

  const configured = computed(() => {
    if (!enabled.value) {
      return false
    }

    if (!userId.value.trim() || !baseUrl.value.trim() || !embedder.value.trim() || !vectorStore.value.trim()) {
      return false
    }

    if (mode.value === 'platform' && !apiKey.value.trim()) {
      return false
    }

    return true
  })

  function resetValidationState() {
    validationStatus.reset()
    lastValidation.reset()
  }

  async function validateConfiguration() {
    if (!enabled.value) {
      validationStatus.value = 'idle'
      lastValidation.value = 'Short-term memory is disabled.'
      return { valid: false, message: lastValidation.value }
    }

    if (!userId.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'User ID is required before mem0 can be used.'
      return { valid: false, message: lastValidation.value }
    }

    if (!baseUrl.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'Base URL is required before mem0 can be validated.'
      return { valid: false, message: lastValidation.value }
    }

    if (!isUrl(baseUrl.value.trim())) {
      validationStatus.value = 'error'
      lastValidation.value = 'Base URL must be an absolute URL, including http:// or https://.'
      return { valid: false, message: lastValidation.value }
    }

    const parsedBaseUrl = new URL(baseUrl.value.trim())
    if (!parsedBaseUrl.protocol.startsWith('http')) {
      validationStatus.value = 'error'
      lastValidation.value = 'Base URL must use an HTTP or HTTPS endpoint.'
      return { valid: false, message: lastValidation.value }
    }

    if (!embedder.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'Embedder configuration is required for mem0.'
      return { valid: false, message: lastValidation.value }
    }

    if (!vectorStore.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'Vector store configuration is required for mem0.'
      return { valid: false, message: lastValidation.value }
    }

    if (topK.value < 1) {
      validationStatus.value = 'error'
      lastValidation.value = 'Top K must be at least 1.'
      return { valid: false, message: lastValidation.value }
    }

    if (searchThreshold.value < 0 || searchThreshold.value > 1) {
      validationStatus.value = 'error'
      lastValidation.value = 'Search threshold must stay between 0 and 1.'
      return { valid: false, message: lastValidation.value }
    }

    if (mode.value === 'platform' && !apiKey.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'API key is required when mem0 is configured in platform mode.'
      return { valid: false, message: lastValidation.value }
    }

    if (mode.value !== 'open-source' && mode.value !== 'platform') {
      validationStatus.value = 'error'
      lastValidation.value = 'Mode must be either open-source or platform.'
      return { valid: false, message: lastValidation.value }
    }

    const connectivity = await pingMem0Endpoint(parsedBaseUrl, apiKey.value.trim())
    if (!connectivity.ok) {
      validationStatus.value = 'error'
      lastValidation.value = `mem0 connectivity check failed: ${connectivity.reason}`
      return { valid: false, message: lastValidation.value }
    }

    const baseUrlHost = parsedBaseUrl.host
    validationStatus.value = 'success'
    lastValidation.value = `mem0 connectivity check passed via ${connectivity.probeUrl} (${connectivity.status}) on ${baseUrlHost}.`
    return { valid: true, message: lastValidation.value }
  }

  function resetState() {
    enabled.reset()
    backendId.reset()
    mode.reset()
    userId.reset()
    baseUrl.reset()
    apiKey.reset()
    embedder.reset()
    vectorStore.reset()
    autoRecall.reset()
    autoCapture.reset()
    topK.reset()
    searchThreshold.reset()
    resetValidationState()
  }

  return {
    enabled,
    backendId,
    configured,
    validationStatus,
    lastValidation,
    mode,
    userId,
    baseUrl,
    apiKey,
    embedder,
    vectorStore,
    autoRecall,
    autoCapture,
    topK,
    searchThreshold,
    validateConfiguration,
    resetValidationState,
    resetState,
  }
})
