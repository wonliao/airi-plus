import type { MemoryValidationStatus } from './memory-shared'

import { errorMessageFrom } from '@moeru/std'
import { isUrl } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { StorageSerializers } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

const mem0ConnectivityTimeoutMsec = 5_000

interface Mem0ProbeCandidate {
  kind: 'health' | 'models' | 'openapi' | 'docs'
  url: URL
}

interface Mem0MessageInput {
  role: 'assistant' | 'user'
  content: string
}

interface Mem0SearchResult {
  created_at?: string
  id?: string
  memory?: string
  score?: number
  user_id?: string
}

interface Mem0RuntimeDebugEntry {
  at: string
  latestMemories?: string[]
  message: string
  payload: string
  resultCount?: number
  status: 'error' | 'skipped' | 'success'
}

interface Mem0CaptureResult {
  event?: string
  id?: string
  memory?: string
}

function isLegacyBrokenDebugEntry(value: unknown): value is '[object Object]' {
  return value === '[object Object]'
}

function toDirectoryUrl(baseUrl: URL) {
  return new URL(baseUrl.toString().endsWith('/') ? baseUrl.toString() : `${baseUrl.toString()}/`)
}

function resolveMem0ProbeCandidates(baseUrl: URL) {
  const directoryUrl = toDirectoryUrl(baseUrl)
  const candidates: Mem0ProbeCandidate[] = [
    { kind: 'health', url: new URL('health', directoryUrl) },
    { kind: 'health', url: new URL('healthz', directoryUrl) },
    { kind: 'openapi', url: new URL('openapi.json', directoryUrl) },
    { kind: 'docs', url: new URL('docs', directoryUrl) },
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

function createMem0Headers(apiKey: string, options?: { contentType?: string }) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (options?.contentType) {
    headers['Content-Type'] = options.contentType
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    headers['X-API-Key'] = apiKey
  }

  return headers
}

function parseMem0ResultsPayload(payload: unknown): Mem0SearchResult[] {
  if (Array.isArray(payload)) {
    return payload.filter(entry => !!entry && typeof entry === 'object') as Mem0SearchResult[]
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  const record = payload as { results?: unknown }
  return Array.isArray(record.results)
    ? record.results.filter(entry => !!entry && typeof entry === 'object') as Mem0SearchResult[]
    : []
}

function parseMem0CapturePayload(payload: unknown): Mem0CaptureResult[] {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const record = payload as { results?: unknown }
  return Array.isArray(record.results)
    ? record.results.filter(entry => !!entry && typeof entry === 'object') as Mem0CaptureResult[]
    : []
}

function buildMem0RecallPrompt(results: Mem0SearchResult[]) {
  if (results.length === 0) {
    return ''
  }

  return [
    'These are short-term memories recalled from mem0.',
    'When the user asks about personal preferences, facts, or recent details that match these memories, answer from them directly unless the user is explicitly correcting them.',
    ...results.map((result, index) => {
      const scoreText = typeof result.score === 'number'
        ? ` (score=${result.score.toFixed(3)})`
        : ''
      return `${index + 1}. ${result.memory ?? ''}${scoreText}`
    }),
  ].join('\n')
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
  const lastCaptureDebug = useLocalStorageManualReset<Mem0RuntimeDebugEntry | null>('settings/memory/short-term/debug/last-capture', null, {
    serializer: StorageSerializers.object,
  })
  const lastRecallDebug = useLocalStorageManualReset<Mem0RuntimeDebugEntry | null>('settings/memory/short-term/debug/last-recall', null, {
    serializer: StorageSerializers.object,
  })

  if (isLegacyBrokenDebugEntry(lastCaptureDebug.value)) {
    lastCaptureDebug.value = null
  }

  if (isLegacyBrokenDebugEntry(lastRecallDebug.value)) {
    lastRecallDebug.value = null
  }

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

  const runtimeReady = computed(() => enabled.value && configured.value && validationStatus.value === 'success')

  function resetValidationState() {
    validationStatus.reset()
    lastValidation.reset()
  }

  function setCaptureDebug(entry: Mem0RuntimeDebugEntry) {
    lastCaptureDebug.value = entry
  }

  function setRecallDebug(entry: Mem0RuntimeDebugEntry) {
    lastRecallDebug.value = entry
  }

  async function fetchLatestMemories() {
    if (!runtimeReady.value) {
      return []
    }

    try {
      const response = await fetch(new URL(`memories?user_id=${encodeURIComponent(userId.value.trim())}`, toDirectoryUrl(new URL(baseUrl.value.trim()))), {
        method: 'GET',
        headers: createMem0Headers(apiKey.value.trim()),
      })

      if (!response.ok) {
        return []
      }

      const payload = await response.json()
      return parseMem0ResultsPayload(payload)
        .map(result => result.memory?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 8)
    }
    catch {
      return []
    }
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

  async function searchMemories(query: string) {
    if (!runtimeReady.value) {
      setRecallDebug({
        at: new Date().toISOString(),
        message: 'Recall skipped because short-term memory is not runtime-ready.',
        payload: query.trim(),
        status: 'skipped',
      })
      return []
    }

    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setRecallDebug({
        at: new Date().toISOString(),
        message: 'Recall skipped because the query was empty.',
        payload: '',
        status: 'skipped',
      })
      return []
    }

    try {
      const response = await fetch(new URL('search', toDirectoryUrl(new URL(baseUrl.value.trim()))), {
        method: 'POST',
        headers: createMem0Headers(apiKey.value.trim(), { contentType: 'application/json' }),
        body: JSON.stringify({
          query: trimmedQuery,
          user_id: userId.value.trim(),
        }),
      })

      if (!response.ok) {
        console.warn(`[mem0] search failed with HTTP ${response.status}`)
        setRecallDebug({
          at: new Date().toISOString(),
          message: `Recall failed with HTTP ${response.status}.`,
          payload: trimmedQuery,
          status: 'error',
        })
        return []
      }

      const payload = await response.json()
      const results = parseMem0ResultsPayload(payload).slice(0, topK.value)
      const thresholdedResults = results.filter((result) => {
        if (typeof result.score !== 'number') {
          return true
        }

        return result.score >= searchThreshold.value
      })

      // NOTICE: Natural-language recall questions can score just below the UI threshold
      // even when mem0's best hit is still clearly relevant. Falling back to the best
      // available hit avoids "I don't know" responses when memory exists but ranking is noisy.
      const finalResults = thresholdedResults.length > 0 ? thresholdedResults : results.slice(0, 1)
      setRecallDebug({
        at: new Date().toISOString(),
        latestMemories: results.map(result => result.memory?.trim() ?? '').filter(Boolean).slice(0, 8),
        message: finalResults.length > 0
          ? `Recall returned ${finalResults.length} memory item(s).`
          : 'Recall completed but mem0 returned no matching memory.',
        payload: trimmedQuery,
        resultCount: finalResults.length,
        status: 'success',
      })
      return finalResults
    }
    catch (error) {
      console.warn('[mem0] search request failed', errorMessageFrom(error) ?? error)
      setRecallDebug({
        at: new Date().toISOString(),
        message: `Recall request failed: ${errorMessageFrom(error) ?? 'Unknown error.'}`,
        payload: trimmedQuery,
        status: 'error',
      })
      return []
    }
  }

  async function captureMessages(messages: Mem0MessageInput[]) {
    if (!runtimeReady.value || !autoCapture.value) {
      setCaptureDebug({
        at: new Date().toISOString(),
        message: !runtimeReady.value
          ? 'Capture skipped because short-term memory is not runtime-ready.'
          : 'Capture skipped because auto capture is disabled.',
        payload: messages.map(message => `[${message.role}] ${message.content.trim()}`).filter(Boolean).join('\n'),
        status: 'skipped',
      })
      return false
    }

    const usableMessages = messages
      .map(message => ({
        role: message.role,
        content: message.content.trim(),
      }))
      .filter(message => !!message.content)

    if (usableMessages.length === 0) {
      setCaptureDebug({
        at: new Date().toISOString(),
        message: 'Capture skipped because there was no usable message content.',
        payload: '',
        status: 'skipped',
      })
      return false
    }

    try {
      const response = await fetch(new URL('memories', toDirectoryUrl(new URL(baseUrl.value.trim()))), {
        method: 'POST',
        headers: createMem0Headers(apiKey.value.trim(), { contentType: 'application/json' }),
        body: JSON.stringify({
          messages: usableMessages,
          user_id: userId.value.trim(),
        }),
      })

      if (!response.ok) {
        console.warn(`[mem0] capture failed with HTTP ${response.status}`)
        setCaptureDebug({
          at: new Date().toISOString(),
          message: `Capture failed with HTTP ${response.status}.`,
          payload: usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
          status: 'error',
        })
        return false
      }

      const payload = await response.json()
      const results = parseMem0CapturePayload(payload)
      const latestMemories = await fetchLatestMemories()
      setCaptureDebug({
        at: new Date().toISOString(),
        latestMemories,
        message: results.length > 0
          ? `Capture sent ${usableMessages.length} message(s) to mem0 and mem0 returned ${results.length} result item(s).`
          : `Capture sent ${usableMessages.length} message(s) to mem0.`,
        payload: usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
        resultCount: results.length || usableMessages.length,
        status: 'success',
      })
      return true
    }
    catch (error) {
      console.warn('[mem0] capture request failed', errorMessageFrom(error) ?? error)
      setCaptureDebug({
        at: new Date().toISOString(),
        message: `Capture request failed: ${errorMessageFrom(error) ?? 'Unknown error.'}`,
        payload: usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
        status: 'error',
      })
      return false
    }
  }

  async function buildRecallPrompt(query: string) {
    if (!runtimeReady.value || !autoRecall.value) {
      return null
    }

    const results = await searchMemories(query)
    const prompt = buildMem0RecallPrompt(results)

    if (!prompt) {
      return null
    }

    return {
      prompt,
      results,
    }
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
    lastCaptureDebug.reset()
    lastRecallDebug.reset()
    resetValidationState()
  }

  return {
    enabled,
    backendId,
    configured,
    runtimeReady,
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
    lastCaptureDebug,
    lastRecallDebug,
    buildRecallPrompt,
    captureMessages,
    searchMemories,
    validateConfiguration,
    resetValidationState,
    resetState,
  }
})
