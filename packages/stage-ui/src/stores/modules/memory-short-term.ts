import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { MemoryValidationStatus } from './memory-shared'

import { errorMessageFrom } from '@moeru/std'
import {
  captureShortTermMemoryOnDesktop,
  clearShortTermMemoryOnDesktop,
  isAbsoluteFilesystemPath,
  isElectronManagedMemoryAlias,
  isElectronManagedRelativePath,
  isStageTamagotchi,
  isUrl,
  listShortTermMemoryOnDesktop,
  searchShortTermMemoryOnDesktop,
  validateShortTermMemoryOnDesktop,
} from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { StorageSerializers } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { extractShortTermMemoryCandidatesWithLlm } from '../chat/memory-extraction'
import { reconcileShortTermMemoryCandidates } from '../chat/memory-reconcile'
import { useProvidersStore } from '../providers'
import { useConsciousnessStore } from './consciousness'

const mem0ConnectivityTimeoutMsec = 5_000
const shortTermMemoryClearTimeoutMsec = 5_000

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
  captureMode?: 'default' | 'llm-assisted'
  candidates?: string[]
  events?: Array<{
    event: 'add' | 'delete' | 'update'
    id?: string
    memory?: string
    previousMemory?: string
  }>
  matchedItems?: Array<{
    category?: string
    conflictKey?: string
    matchedBy?: string[]
    memory: string
    score?: number
  }>
  latestMemoryItems?: Array<{
    category?: string
    conflictKey?: string
    id?: string
    memory: string
  }>
  latestMemories?: string[]
  message: string
  operations?: string[]
  payload: string
  resultCount?: number
  status: 'error' | 'skipped' | 'success'
}

interface Mem0CaptureResult {
  event?: string
  id?: string
  memory?: string
}

const MEMORY_OPERATION_LINE_PATTERN = /^(?:ADD|NONE|UPDATE|DELETE):/u
const MEMORY_CANDIDATE_PREFIX_PATTERN = /^(?:ADD|NONE):\s*/u
const CJK_QUERY_PATTERN = /[\u3400-\u9FFF\uF900-\uFAFF]/u

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

function formatCaptureOperations(
  items: Array<{ event?: string, memory?: string, previousMemory?: string }> | undefined,
  fallbackSummary?: string,
) {
  const itemOperations = (items ?? [])
    .filter(item => item.event === 'add' || item.event === 'delete' || item.event === 'update')
    .map((item) => {
      if (item.event === 'update' && item.previousMemory && item.previousMemory !== item.memory) {
        return `UPDATE: ${item.previousMemory} -> ${item.memory ?? ''}`
      }

      if (item.event === 'delete') {
        return `DELETE: ${item.previousMemory ?? item.memory ?? ''}`
      }

      return `${String(item.event).toUpperCase()}: ${item.memory ?? ''}`
    })
    .filter(Boolean)

  if (itemOperations.length > 0) {
    return itemOperations
  }

  return fallbackSummary
    ? fallbackSummary.split('\n').filter(line => MEMORY_OPERATION_LINE_PATTERN.test(line))
    : undefined
}

function toRuntimeDebugEvents(
  items: Array<{ event?: string, id?: string, memory?: string, previousMemory?: string }> | undefined,
) {
  return (items ?? [])
    .filter(item => item.event === 'add' || item.event === 'delete' || item.event === 'update')
    .map(item => ({
      event: item.event as 'add' | 'delete' | 'update',
      id: item.id,
      memory: item.memory,
      previousMemory: item.previousMemory,
    }))
}

function looksLikeChineseQuery(query: string) {
  return CJK_QUERY_PATTERN.test(query)
}

function buildMem0RecallPrompt(query: string, results: Mem0SearchResult[]) {
  if (results.length === 0) {
    return ''
  }

  const bestMatch = results[0]?.memory?.trim()
  const answerLanguageInstruction = looksLikeChineseQuery(query)
    ? 'Answer in Traditional Chinese.'
    : 'Answer in the user\'s language.'

  return [
    'These are short-term memories recalled from mem0.',
    `User question: ${query}`,
    answerLanguageInstruction,
    'When the user asks about personal preferences, facts, or recent details that match these memories, answer from them directly unless the user is explicitly correcting them.',
    'If one of the recalled memories directly answers the question, do not say you are unsure or that you do not know.',
    'Prefer the best matching recalled memory over speculation, and answer plainly with that memory.',
    ...(bestMatch
      ? [
          `Best matching memory: ${bestMatch}`,
          'If the best matching memory answers the question, use it directly in the final answer.',
        ]
      : []),
    ...results.map((result, index) => {
      const scoreText = typeof result.score === 'number'
        ? ` (score=${result.score.toFixed(3)})`
        : ''
      return `${index + 1}. ${result.memory ?? ''}${scoreText}`
    }),
  ].join('\n')
}

export function resolveShortTermMemoryBackendMode(options: {
  baseUrl: string
  stageTamagotchi: boolean
}) {
  const trimmedBaseUrl = options.baseUrl.trim()

  if (isUrl(trimmedBaseUrl)) {
    return 'remote-mem0' as const
  }

  if (
    options.stageTamagotchi
    && (
      !trimmedBaseUrl
      || isElectronManagedMemoryAlias(trimmedBaseUrl, 'mem0')
      || isElectronManagedRelativePath(trimmedBaseUrl)
      || isAbsoluteFilesystemPath(trimmedBaseUrl)
    )
  ) {
    return 'desktop-local' as const
  }

  return 'remote-mem0' as const
}

const defaultShortTermMemorySettings = {
  autoCapture: true,
  autoRecall: true,
  baseUrl: 'mem0',
  embedder: 'airi-local',
  enabled: true,
  extractionLlmApiKey: '',
  extractionLlmModel: '',
  extractionLlmProvider: '',
  mode: 'open-source',
  searchThreshold: 0.6,
  topK: 5,
  userId: 'local',
  vectorStore: 'local-file',
} as const

export function resolveExtractionLlmDefaults(params: {
  currentProvider: string
  currentModel: string
  consciousnessProvider: string
  consciousnessModel: string
}) {
  return {
    provider: params.currentProvider.trim() || params.consciousnessProvider.trim(),
    model: params.currentModel.trim() || params.consciousnessModel.trim(),
  }
}

export const useShortTermMemoryStore = defineStore('memory-short-term', () => {
  const providersStore = useProvidersStore()
  const consciousnessStore = useConsciousnessStore()

  const enabled = useLocalStorageManualReset<boolean>('settings/memory/short-term/enabled', defaultShortTermMemorySettings.enabled)
  const backendId = useLocalStorageManualReset<string>('settings/memory/short-term/backend-id', 'mem0')
  const validationStatus = useLocalStorageManualReset<MemoryValidationStatus>('settings/memory/short-term/validation-status', 'idle')
  const lastValidation = useLocalStorageManualReset<string>('settings/memory/short-term/last-validation', '')

  const mode = useLocalStorageManualReset<string>('settings/memory/short-term/mode', defaultShortTermMemorySettings.mode)
  const userId = useLocalStorageManualReset<string>('settings/memory/short-term/user-id', defaultShortTermMemorySettings.userId)
  const baseUrl = useLocalStorageManualReset<string>('settings/memory/short-term/base-url', defaultShortTermMemorySettings.baseUrl)
  const apiKey = useLocalStorageManualReset<string>('settings/memory/short-term/api-key', '')
  const extractionLlmProvider = useLocalStorageManualReset<string>('settings/memory/short-term/extraction-llm-provider', defaultShortTermMemorySettings.extractionLlmProvider)
  const extractionLlmModel = useLocalStorageManualReset<string>('settings/memory/short-term/extraction-llm-model', defaultShortTermMemorySettings.extractionLlmModel)
  const extractionLlmApiKey = useLocalStorageManualReset<string>('settings/memory/short-term/extraction-llm-api-key', defaultShortTermMemorySettings.extractionLlmApiKey)
  const embedder = useLocalStorageManualReset<string>('settings/memory/short-term/embedder', defaultShortTermMemorySettings.embedder)
  const vectorStore = useLocalStorageManualReset<string>('settings/memory/short-term/vector-store', defaultShortTermMemorySettings.vectorStore)
  const autoRecall = useLocalStorageManualReset<boolean>('settings/memory/short-term/auto-recall', defaultShortTermMemorySettings.autoRecall)
  const autoCapture = useLocalStorageManualReset<boolean>('settings/memory/short-term/auto-capture', defaultShortTermMemorySettings.autoCapture)
  const topK = useLocalStorageManualReset<number>('settings/memory/short-term/top-k', defaultShortTermMemorySettings.topK)
  const searchThreshold = useLocalStorageManualReset<number>('settings/memory/short-term/search-threshold', defaultShortTermMemorySettings.searchThreshold)
  const lastCaptureDebug = useLocalStorageManualReset<Mem0RuntimeDebugEntry | null>('settings/memory/short-term/debug/last-capture', null, {
    serializer: StorageSerializers.object,
  })
  const lastRecallDebug = useLocalStorageManualReset<Mem0RuntimeDebugEntry | null>('settings/memory/short-term/debug/last-recall', null, {
    serializer: StorageSerializers.object,
  })
  const isClearing = ref(false)

  if (isLegacyBrokenDebugEntry(lastCaptureDebug.value)) {
    lastCaptureDebug.value = null
  }

  if (isLegacyBrokenDebugEntry(lastRecallDebug.value)) {
    lastRecallDebug.value = null
  }

  if (isStageTamagotchi()) {
    if (!userId.value.trim()) {
      userId.value = defaultShortTermMemorySettings.userId
    }

    if (!baseUrl.value.trim()) {
      baseUrl.value = defaultShortTermMemorySettings.baseUrl
    }

    if (!embedder.value.trim()) {
      embedder.value = defaultShortTermMemorySettings.embedder
    }

    if (!vectorStore.value.trim()) {
      vectorStore.value = defaultShortTermMemorySettings.vectorStore
    }
  }

  const applyExtractionLlmDefaults = () => {
    const defaults = resolveExtractionLlmDefaults({
      currentProvider: extractionLlmProvider.value,
      currentModel: extractionLlmModel.value,
      consciousnessProvider: consciousnessStore.activeProvider,
      consciousnessModel: consciousnessStore.activeModel,
    })

    if (!extractionLlmProvider.value.trim() && defaults.provider) {
      extractionLlmProvider.value = defaults.provider
    }

    if (!extractionLlmModel.value.trim() && defaults.model) {
      extractionLlmModel.value = defaults.model
    }
  }

  applyExtractionLlmDefaults()

  watch(
    () => [consciousnessStore.activeProvider, consciousnessStore.activeModel],
    () => {
      applyExtractionLlmDefaults()
    },
  )

  const usesDesktopRuntime = computed(() => {
    if (!isStageTamagotchi()) {
      return false
    }

    const trimmedBaseUrl = baseUrl.value.trim()
    return !trimmedBaseUrl
      || isElectronManagedMemoryAlias(trimmedBaseUrl, 'mem0')
      || isElectronManagedRelativePath(trimmedBaseUrl)
      || isAbsoluteFilesystemPath(trimmedBaseUrl)
  })

  const extractionLlmConfigured = computed(() =>
    !!extractionLlmProvider.value.trim()
    && !!extractionLlmModel.value.trim()
    && !!providersStore.configuredProviders[extractionLlmProvider.value.trim()],
  )

  const extractionProviderOptions = computed(() =>
    providersStore.configuredChatProvidersMetadata.map(provider => ({
      description: provider.localizedDescription || provider.description,
      label: provider.localizedName || provider.name,
      value: provider.id,
    })),
  )

  const extractionModelOptions = computed(() =>
    providersStore.getModelsForProvider(extractionLlmProvider.value.trim()).map(model => ({
      description: model.description || model.provider,
      label: model.name || model.id,
      value: model.id,
    })),
  )

  const extractionMode = computed<'default' | 'llm-assisted'>(() =>
    extractionLlmConfigured.value ? 'llm-assisted' : 'default',
  )

  const configured = computed(() => {
    if (!enabled.value) {
      return false
    }

    if (!userId.value.trim() || !embedder.value.trim() || !vectorStore.value.trim()) {
      return false
    }

    if (!usesDesktopRuntime.value && !baseUrl.value.trim()) {
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

  async function ensureExtractionProviderModelsLoaded() {
    const providerId = extractionLlmProvider.value.trim()
    if (!providerId || !providersStore.configuredProviders[providerId]) {
      return
    }

    if (providersStore.getModelsForProvider(providerId).length > 0) {
      return
    }

    await providersStore.fetchModelsForProvider(providerId)
  }

  function setCaptureDebug(entry: Mem0RuntimeDebugEntry) {
    lastCaptureDebug.value = entry
  }

  function setRecallDebug(entry: Mem0RuntimeDebugEntry) {
    lastRecallDebug.value = entry
  }

  async function markRecallSkipped(reason: string, query: string) {
    setRecallDebug({
      at: new Date().toISOString(),
      latestMemoryItems: await fetchLatestMemoryItems(),
      latestMemories: await fetchLatestMemories(),
      message: reason,
      payload: query.trim(),
      status: 'skipped',
    })
  }

  async function fetchLatestMemories() {
    if (!runtimeReady.value) {
      return []
    }

    if (usesDesktopRuntime.value) {
      try {
        const response = await listShortTermMemoryOnDesktop({
          baseUrl: baseUrl.value.trim(),
          userId: userId.value.trim(),
          limit: 8,
        })

        return response?.ok
          ? response.items.map(result => result.memory?.trim() ?? '').filter(Boolean).slice(0, 8)
          : []
      }
      catch {
        return []
      }
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

  async function fetchLatestMemoryItems() {
    if (!runtimeReady.value) {
      return []
    }

    if (usesDesktopRuntime.value) {
      try {
        const response = await listShortTermMemoryOnDesktop({
          baseUrl: baseUrl.value.trim(),
          userId: userId.value.trim(),
          limit: 8,
        })

        return response?.ok
          ? response.items.map(item => ({
              category: item.category,
              conflictKey: item.conflictKey,
              id: item.id,
              memory: item.memory?.trim() ?? '',
            })).filter(item => item.memory)
          : []
      }
      catch {
        return []
      }
    }

    return []
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

    if (!usesDesktopRuntime.value && !baseUrl.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'Base URL is required before mem0 can be validated.'
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

    if (usesDesktopRuntime.value) {
      try {
        const desktopValidation = await validateShortTermMemoryOnDesktop({
          mode: mode.value,
          userId: userId.value.trim(),
          baseUrl: baseUrl.value.trim(),
          apiKey: apiKey.value.trim(),
          embedder: embedder.value.trim(),
          vectorStore: vectorStore.value.trim(),
          topK: topK.value,
          searchThreshold: searchThreshold.value,
        })

        if (desktopValidation) {
          validationStatus.value = desktopValidation.valid ? 'success' : 'error'
          lastValidation.value = desktopValidation.message
          return { valid: desktopValidation.valid, message: desktopValidation.message }
        }
      }
      catch (error) {
        validationStatus.value = 'error'
        lastValidation.value = errorMessageFrom(error) ?? 'Desktop short-term memory validation failed.'
        return { valid: false, message: lastValidation.value }
      }
    }

    if (!isUrl(baseUrl.value.trim())) {
      validationStatus.value = 'error'
      lastValidation.value = 'Base URL must be an absolute URL, `mem0`, or a path relative to AIRI app data.'
      return { valid: false, message: lastValidation.value }
    }

    const parsedBaseUrl = new URL(baseUrl.value.trim())
    if (!parsedBaseUrl.protocol.startsWith('http')) {
      validationStatus.value = 'error'
      lastValidation.value = 'Base URL must use an HTTP or HTTPS endpoint.'
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
      if (usesDesktopRuntime.value) {
        const response = await searchShortTermMemoryOnDesktop({
          baseUrl: baseUrl.value.trim(),
          userId: userId.value.trim(),
          query: trimmedQuery,
          topK: topK.value,
          searchThreshold: searchThreshold.value,
        })

        const finalResults = response?.ok ? response.items.slice(0, topK.value) : []
        setRecallDebug({
          at: new Date().toISOString(),
          matchedItems: finalResults.map(item => ({
            category: item.category,
            conflictKey: item.conflictKey,
            matchedBy: item.matchedBy,
            memory: item.memory,
            score: item.score,
          })),
          latestMemoryItems: response?.latestMemoryItems?.map(item => ({
            category: item.category,
            conflictKey: item.conflictKey,
            id: item.id,
            memory: item.memory,
          })) ?? [],
          latestMemories: response?.latestMemories ?? [],
          message: response?.message ?? 'Desktop short-term recall is unavailable.',
          payload: trimmedQuery,
          resultCount: finalResults.length,
          status: response?.ok ? 'success' : 'error',
        })
        return finalResults
      }

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

    const latestMemories = await fetchLatestMemories()
    let captureMessagesForRuntime = usableMessages
    let extractionSummary = ''

    if (extractionMode.value === 'llm-assisted') {
      const providerId = extractionLlmProvider.value.trim()
      const modelId = extractionLlmModel.value.trim()

      try {
        const provider = await providersStore.getProviderInstance<ChatProvider>(providerId)
        const extraction = await extractShortTermMemoryCandidatesWithLlm({
          provider,
          model: modelId,
          existingMemories: latestMemories,
          messages: usableMessages,
        })
        const operations = reconcileShortTermMemoryCandidates(extraction.candidates, latestMemories)
        const candidatesToStore = operations
          .filter(operation => operation.kind === 'add' || operation.kind === 'delete')
          .map(operation => ({
            ...operation.candidate,
            captureText: operation.kind === 'delete'
              ? `__DELETE__:${operation.candidate.captureText}`
              : operation.candidate.captureText,
          }))

        extractionSummary = [
          `mode=llm-assisted provider=${providerId} model=${modelId}`,
          extraction.rawText ? `raw=${extraction.rawText}` : '',
          ...operations.map((operation) => {
            return `${operation.kind.toUpperCase()}: ${operation.candidate.fact}${operation.matchedMemory ? ` (matched ${operation.matchedMemory})` : ''}`
          }),
        ]
          .filter(Boolean)
          .join('\n')

        if (candidatesToStore.length === 0) {
          setCaptureDebug({
            at: new Date().toISOString(),
            captureMode: 'llm-assisted',
            candidates: extraction.candidates.map(candidate => candidate.fact),
            latestMemoryItems: [],
            latestMemories,
            message: extraction.error
              ? `LLM-assisted capture fell back to built-in capture because extraction failed: ${extraction.error}`
              : 'LLM-assisted capture found no stable memory candidate in this turn.',
            operations: operations.map((operation) => {
              return `${operation.kind.toUpperCase()}: ${operation.candidate.fact}${operation.matchedMemory ? ` (matched ${operation.matchedMemory})` : ''}`
            }),
            payload: [
              usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
              extractionSummary,
            ].filter(Boolean).join('\n\n'),
            resultCount: 0,
            status: extraction.error ? 'error' : 'success',
          })

          if (!extraction.error) {
            return false
          }
        }
        else {
          captureMessagesForRuntime = candidatesToStore.map(candidate => ({
            role: 'user' as const,
            content: candidate.captureText,
          }))
        }
      }
      catch (error) {
        extractionSummary = `mode=llm-assisted provider=${providerId} model=${modelId}\nerror=${errorMessageFrom(error) ?? 'Unknown provider error.'}`
      }
    }

    try {
      if (usesDesktopRuntime.value) {
        const response = await captureShortTermMemoryOnDesktop({
          baseUrl: baseUrl.value.trim(),
          userId: userId.value.trim(),
          messages: captureMessagesForRuntime,
        })

        setCaptureDebug({
          at: new Date().toISOString(),
          captureMode: extractionMode.value,
          events: toRuntimeDebugEvents(response?.items),
          latestMemoryItems: response?.latestMemoryItems?.map(item => ({
            category: item.category,
            conflictKey: item.conflictKey,
            id: item.id,
            memory: item.memory,
          })) ?? [],
          latestMemories: response?.latestMemories ?? [],
          message: response?.message ?? 'Desktop short-term capture is unavailable.',
          operations: formatCaptureOperations(response?.items, extractionSummary),
          payload: [
            usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
            extractionSummary,
            captureMessagesForRuntime !== usableMessages
              ? `capture-input:\n${captureMessagesForRuntime.map(message => `[${message.role}] ${message.content}`).join('\n')}`
              : '',
          ].filter(Boolean).join('\n\n'),
          resultCount: response?.items.length ?? 0,
          status: response?.ok ? 'success' : 'error',
        })
        return response?.ok ?? false
      }

      const response = await fetch(new URL('memories', toDirectoryUrl(new URL(baseUrl.value.trim()))), {
        method: 'POST',
        headers: createMem0Headers(apiKey.value.trim(), { contentType: 'application/json' }),
        body: JSON.stringify({
          messages: captureMessagesForRuntime,
          user_id: userId.value.trim(),
        }),
      })

      if (!response.ok) {
        console.warn(`[mem0] capture failed with HTTP ${response.status}`)
        setCaptureDebug({
          at: new Date().toISOString(),
          captureMode: extractionMode.value,
          message: `Capture failed with HTTP ${response.status}.`,
          operations: extractionSummary
            ? extractionSummary.split('\n').filter(line => MEMORY_OPERATION_LINE_PATTERN.test(line))
            : undefined,
          payload: [
            usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
            extractionSummary,
          ].filter(Boolean).join('\n\n'),
          status: 'error',
        })
        return false
      }

      const payload = await response.json()
      const results = parseMem0CapturePayload(payload)
      const latestMemories = await fetchLatestMemories()
      const latestMemoryItems = await fetchLatestMemoryItems()
      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: extractionMode.value,
        candidates: extractionSummary
          ? extractionSummary.split('\n').filter(line => line.startsWith('ADD:') || line.startsWith('NONE:')).map(line => line.replace(MEMORY_CANDIDATE_PREFIX_PATTERN, ''))
          : undefined,
        events: toRuntimeDebugEvents(results),
        latestMemoryItems,
        latestMemories,
        message: results.length > 0
          ? `Capture sent ${captureMessagesForRuntime.length} message(s) to mem0 and mem0 returned ${results.length} result item(s).`
          : `Capture sent ${captureMessagesForRuntime.length} message(s) to mem0.`,
        operations: formatCaptureOperations(results, extractionSummary),
        payload: [
          usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
          extractionSummary,
          captureMessagesForRuntime !== usableMessages
            ? `capture-input:\n${captureMessagesForRuntime.map(message => `[${message.role}] ${message.content}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n\n'),
        resultCount: results.length || captureMessagesForRuntime.length,
        status: 'success',
      })
      return true
    }
    catch (error) {
      console.warn('[mem0] capture request failed', errorMessageFrom(error) ?? error)
      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: extractionMode.value,
        operations: extractionSummary
          ? extractionSummary.split('\n').filter(line => MEMORY_OPERATION_LINE_PATTERN.test(line))
          : undefined,
        message: `Capture request failed: ${errorMessageFrom(error) ?? 'Unknown error.'}`,
        payload: [
          usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
          extractionSummary,
        ].filter(Boolean).join('\n\n'),
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
    const prompt = buildMem0RecallPrompt(query, results)

    if (!prompt) {
      return null
    }

    return {
      prompt,
      results,
    }
  }

  async function clearShortTermMemory() {
    if (!configured.value) {
      throw new Error('Short-term memory must be configured before it can be cleared.')
    }

    if (!usesDesktopRuntime.value) {
      throw new Error('Clearing short-term memory from this page is currently supported only for AIRI Electron managed runtime.')
    }

    isClearing.value = true

    try {
      const response = await Promise.race([
        clearShortTermMemoryOnDesktop({
          baseUrl: baseUrl.value.trim(),
          userId: userId.value.trim(),
        }),
        new Promise<undefined>((resolve) => {
          setTimeout(resolve, shortTermMemoryClearTimeoutMsec, undefined)
        }),
      ])

      if (!response?.ok) {
        throw new Error(response?.message || 'Failed to clear short-term memory. If AIRI Electron was not restarted after this feature was added, please reopen AIRI and try again.')
      }

      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: extractionMode.value,
        events: [],
        latestMemoryItems: response.latestMemoryItems?.map(item => ({
          category: item.category,
          conflictKey: item.conflictKey,
          id: item.id,
          memory: item.memory,
        })) ?? [],
        latestMemories: response.latestMemories,
        message: response.message,
        operations: response.deletedCount > 0
          ? [`CLEAR: deleted ${response.deletedCount} short-term memory item(s)`]
          : undefined,
        payload: `Cleared short-term memory for user ${userId.value.trim()}.`,
        resultCount: response.deletedCount,
        status: 'success',
      })
    }
    catch (error) {
      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: extractionMode.value,
        message: `Clear request failed: ${errorMessageFrom(error) ?? 'Unknown error.'}`,
        payload: `Clear short-term memory for user ${userId.value.trim()}.`,
        status: 'error',
      })
      throw error
    }
    finally {
      isClearing.value = false
    }
  }

  function resetState() {
    enabled.reset()
    backendId.reset()
    mode.reset()
    userId.reset()
    baseUrl.reset()
    apiKey.reset()
    extractionLlmProvider.reset()
    extractionLlmModel.reset()
    extractionLlmApiKey.reset()
    embedder.reset()
    vectorStore.reset()
    autoRecall.reset()
    autoCapture.reset()
    topK.reset()
    searchThreshold.reset()
    lastCaptureDebug.reset()
    lastRecallDebug.reset()
    resetValidationState()
    isClearing.value = false
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
    extractionMode,
    extractionLlmProvider,
    extractionLlmModel,
    extractionLlmApiKey,
    extractionLlmConfigured,
    extractionProviderOptions,
    extractionModelOptions,
    embedder,
    vectorStore,
    isClearing,
    autoRecall,
    autoCapture,
    topK,
    searchThreshold,
    lastCaptureDebug,
    lastRecallDebug,
    buildRecallPrompt,
    captureMessages,
    clearShortTermMemory,
    markRecallSkipped,
    ensureExtractionProviderModelsLoaded,
    searchMemories,
    validateConfiguration,
    resetValidationState,
    resetState,
  }
})
