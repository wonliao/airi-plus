import type { MemoryValidationStatus } from './memory-shared'

import { errorMessageFrom } from '@moeru/std'
import {
  captureShortTermMemoryOnDesktop,
  clearShortTermMemoryOnDesktop,
  listShortTermMemoryOnDesktop,
  searchShortTermMemoryOnDesktop,
  validateShortTermMemoryOnDesktop,
} from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { StorageSerializers } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const shortTermMemoryClearTimeoutMsec = 5_000
const mem0DefaultBaseUrl = 'http://127.0.0.1:8000'
const cjkQueryPattern = /[\u3400-\u9FFF\uF900-\uFAFF]/u
const memoryOperationLinePattern = /^(?:ADD|NONE|UPDATE|DELETE|CLEAR):/u

interface Mem0MessageInput {
  role: 'assistant' | 'user'
  content: string
}

interface Mem0SearchResult {
  content?: string
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
  event_id?: string
  id?: string
  memory?: string
  previousMemory?: string
  previous_memory?: string
  status?: string
}

interface ShortTermMemoryListLikePayload {
  apiKey: string
  baseUrl: string
  userId: string
  agentId?: string
  runId?: string
  appId?: string
  limit?: number
}

function isLegacyBrokenDebugEntry(value: unknown): value is '[object Object]' {
  return value === '[object Object]'
}

function looksLikeChineseQuery(query: string) {
  return cjkQueryPattern.test(query)
}

function readMem0MemoryText(result: Mem0SearchResult) {
  return result.memory?.trim() || result.content?.trim() || ''
}

function buildMem0RecallPrompt(query: string, results: Mem0SearchResult[]) {
  if (results.length === 0) {
    return ''
  }

  const bestMatch = readMem0MemoryText(results[0] ?? {})
  const answerLanguageInstruction = looksLikeChineseQuery(query)
    ? 'Answer in Traditional Chinese.'
    : 'Answer in the user\'s language.'

  return [
    'These are short-term memories recalled from the configured memory backend.',
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
      return `${index + 1}. ${readMem0MemoryText(result)}${scoreText}`
    }),
  ].join('\n')
}

export function normalizeMem0BaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/u, '')
  return trimmed || mem0DefaultBaseUrl
}

export function resolveMem0RemotePath(operation: 'memories' | 'search') {
  return operation === 'search' ? 'search' : 'memories'
}

function buildMem0Scope(options: {
  userId: string
  agentId?: string
  runId?: string
  appId?: string
}) {
  return {
    user_id: options.userId.trim(),
    ...(options.agentId?.trim() ? { agent_id: options.agentId.trim() } : {}),
    ...(options.runId?.trim() ? { run_id: options.runId.trim() } : {}),
    ...(options.appId?.trim() ? { app_id: options.appId.trim() } : {}),
  }
}

export function buildMem0ListQuery(options: {
  userId: string
  agentId?: string
  runId?: string
  limit?: number
}) {
  const query = new URLSearchParams()
  query.set('user_id', options.userId.trim())

  if (options.agentId?.trim()) {
    query.set('agent_id', options.agentId.trim())
  }

  if (options.runId?.trim()) {
    query.set('run_id', options.runId.trim())
  }

  if (typeof options.limit === 'number') {
    query.set('limit', String(Math.max(1, Math.min(options.limit, 100))))
  }

  return query
}

export function buildMem0SearchRequestBody(options: {
  query: string
  userId: string
  agentId?: string
  runId?: string
  appId?: string
  topK: number
}) {
  return {
    query: options.query.trim(),
    top_k: options.topK,
    ...buildMem0Scope(options),
  }
}

export function buildMem0CaptureRequestBody(options: {
  messages: Mem0MessageInput[]
  userId: string
  agentId?: string
  runId?: string
  appId?: string
}) {
  return {
    async_mode: false,
    infer: true,
    messages: options.messages,
    ...buildMem0Scope(options),
  }
}

export function createMem0Headers(apiKey: string, options?: { contentType?: string }) {
  return {
    Accept: 'application/json',
    ...(options?.contentType ? { 'Content-Type': options.contentType } : {}),
    ...(apiKey.trim() ? { 'X-API-Key': apiKey.trim() } : {}),
  }
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
    ? fallbackSummary.split('\n').filter(line => memoryOperationLinePattern.test(line))
    : undefined
}

function toRuntimeDebugEvents(items: Mem0CaptureResult[] | undefined) {
  return (items ?? [])
    .filter(item => item.event === 'add' || item.event === 'delete' || item.event === 'update')
    .map(item => ({
      event: item.event as 'add' | 'delete' | 'update',
      id: item.id ?? item.event_id,
      memory: item.memory,
      previousMemory: item.previousMemory ?? item.previous_memory,
    }))
}

async function parseRemoteJson(response: Response) {
  const text = await response.text()
  if (!text.trim()) {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  }
  catch {
    throw new Error(`Remote Mem0 returned non-JSON response (${response.status}).`)
  }
}

function readRemoteItems(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  const data = payload as Record<string, unknown>
  if (Array.isArray(data.results)) {
    return data.results
  }
  if (Array.isArray(data.items)) {
    return data.items
  }
  if (Array.isArray(data.memories)) {
    return data.memories
  }

  return []
}

function readRemoteMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  const message = (payload as Record<string, unknown>).message
  if (typeof message === 'string' && message.trim()) {
    return message
  }

  const detail = (payload as Record<string, unknown>).detail
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  return fallback
}

async function requestRemoteMem0List(payload: ShortTermMemoryListLikePayload) {
  const url = new URL(resolveMem0RemotePath('memories'), `${normalizeMem0BaseUrl(payload.baseUrl)}/`)
  url.search = buildMem0ListQuery(payload).toString()

  const response = await fetch(url, {
    headers: createMem0Headers(payload.apiKey),
    method: 'GET',
  })
  const responsePayload = await parseRemoteJson(response)
  if (!response.ok) {
    throw new Error(readRemoteMessage(responsePayload, `Remote Mem0 list failed (${response.status}).`))
  }

  return readRemoteItems(responsePayload) as Array<Record<string, unknown>>
}

async function validateShortTermMemoryRemote(payload: {
  apiKey: string
  baseUrl: string
  userId: string
  agentId?: string
  runId?: string
}) {
  await requestRemoteMem0List({
    apiKey: payload.apiKey,
    baseUrl: payload.baseUrl,
    userId: payload.userId,
    agentId: payload.agentId,
    limit: 1,
    runId: payload.runId,
  })

  return {
    message: `Remote Mem0 API is reachable at ${normalizeMem0BaseUrl(payload.baseUrl)}.`,
    valid: true,
  }
}

async function searchShortTermMemoryRemote(payload: {
  apiKey: string
  baseUrl: string
  userId: string
  agentId?: string
  runId?: string
  appId?: string
  query: string
  topK: number
}) {
  const response = await fetch(new URL(resolveMem0RemotePath('search'), `${normalizeMem0BaseUrl(payload.baseUrl)}/`), {
    body: JSON.stringify(buildMem0SearchRequestBody(payload)),
    headers: createMem0Headers(payload.apiKey, { contentType: 'application/json' }),
    method: 'POST',
  })
  const responsePayload = await parseRemoteJson(response)
  if (!response.ok) {
    throw new Error(readRemoteMessage(responsePayload, `Remote Mem0 search failed (${response.status}).`))
  }

  return readRemoteItems(responsePayload) as Mem0SearchResult[]
}

async function captureShortTermMemoryRemote(payload: {
  apiKey: string
  baseUrl: string
  userId: string
  agentId?: string
  runId?: string
  appId?: string
  messages: Mem0MessageInput[]
}) {
  const response = await fetch(new URL(resolveMem0RemotePath('memories'), `${normalizeMem0BaseUrl(payload.baseUrl)}/`), {
    body: JSON.stringify(buildMem0CaptureRequestBody(payload)),
    headers: createMem0Headers(payload.apiKey, { contentType: 'application/json' }),
    method: 'POST',
  })
  const responsePayload = await parseRemoteJson(response)
  if (!response.ok) {
    throw new Error(readRemoteMessage(responsePayload, `Remote Mem0 capture failed (${response.status}).`))
  }

  return readRemoteItems(responsePayload) as Mem0CaptureResult[]
}

async function clearShortTermMemoryRemote(payload: {
  apiKey: string
  baseUrl: string
  userId: string
  agentId?: string
  runId?: string
}) {
  const url = new URL(resolveMem0RemotePath('memories'), `${normalizeMem0BaseUrl(payload.baseUrl)}/`)
  url.search = buildMem0ListQuery(payload).toString()

  const response = await fetch(url, {
    headers: createMem0Headers(payload.apiKey),
    method: 'DELETE',
  })
  const responsePayload = await parseRemoteJson(response)
  if (!response.ok) {
    throw new Error(readRemoteMessage(responsePayload, `Remote Mem0 clear failed (${response.status}).`))
  }
}

const defaultShortTermMemorySettings = {
  apiKey: '',
  appId: '',
  agentId: '',
  autoCapture: true,
  autoRecall: true,
  baseUrl: mem0DefaultBaseUrl,
  enabled: true,
  runId: '',
  searchThreshold: 0.6,
  topK: 5,
  userId: 'local',
} as const

export const useShortTermMemoryStore = defineStore('memory-short-term', () => {
  const enabled = useLocalStorageManualReset<boolean>('settings/memory/short-term/enabled', defaultShortTermMemorySettings.enabled)
  const validationStatus = useLocalStorageManualReset<MemoryValidationStatus>('settings/memory/short-term/validation-status', 'idle')
  const lastValidation = useLocalStorageManualReset<string>('settings/memory/short-term/last-validation', '')

  const baseUrl = useLocalStorageManualReset<string>('settings/memory/short-term/base-url', defaultShortTermMemorySettings.baseUrl)
  const apiKey = useLocalStorageManualReset<string>('settings/memory/short-term/api-key', defaultShortTermMemorySettings.apiKey)
  const userId = useLocalStorageManualReset<string>('settings/memory/short-term/user-id', defaultShortTermMemorySettings.userId)
  const agentId = useLocalStorageManualReset<string>('settings/memory/short-term/agent-id', defaultShortTermMemorySettings.agentId)
  const runId = useLocalStorageManualReset<string>('settings/memory/short-term/run-id', defaultShortTermMemorySettings.runId)
  const appId = useLocalStorageManualReset<string>('settings/memory/short-term/app-id', defaultShortTermMemorySettings.appId)
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

  if (!userId.value.trim()) {
    userId.value = defaultShortTermMemorySettings.userId
  }

  if (!baseUrl.value.trim()) {
    baseUrl.value = defaultShortTermMemorySettings.baseUrl
  }

  const backendId = computed(() => 'remote-mem0')
  const configured = computed(() => enabled.value && !!userId.value.trim() && !!baseUrl.value.trim())
  const runtimeReady = computed(() => enabled.value && configured.value && validationStatus.value === 'success')

  function setCaptureDebug(entry: Mem0RuntimeDebugEntry) {
    lastCaptureDebug.value = entry
  }

  function setRecallDebug(entry: Mem0RuntimeDebugEntry) {
    lastRecallDebug.value = entry
  }

  function resetValidationState() {
    validationStatus.reset()
    lastValidation.reset()
  }

  async function fetchLatestMemoryItems() {
    if (!runtimeReady.value) {
      return []
    }

    const payload = {
      apiKey: apiKey.value.trim(),
      appId: appId.value.trim(),
      baseUrl: baseUrl.value.trim(),
      userId: userId.value.trim(),
      agentId: agentId.value.trim(),
      limit: 8,
      runId: runId.value.trim(),
    }

    try {
      const desktopResponse = await listShortTermMemoryOnDesktop(payload)
      const items = desktopResponse?.ok
        ? desktopResponse.items
        : (await requestRemoteMem0List(payload)).map(item => ({
            category: typeof item.category === 'string' ? item.category : undefined,
            conflictKey: typeof item.conflictKey === 'string' ? item.conflictKey : undefined,
            id: typeof item.id === 'string' ? item.id : '',
            memory: typeof item.memory === 'string' ? item.memory : typeof item.content === 'string' ? item.content : '',
          }))

      return items
        .map(item => ({
          category: item.category,
          conflictKey: item.conflictKey,
          id: item.id,
          memory: item.memory?.trim() ?? '',
        }))
        .filter(item => item.memory)
    }
    catch {
      return []
    }
  }

  async function fetchLatestMemories() {
    const items = await fetchLatestMemoryItems()
    return items.map(item => item.memory)
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

  async function validateConfiguration() {
    if (!enabled.value) {
      validationStatus.value = 'idle'
      lastValidation.value = 'Short-term memory is disabled.'
      return { message: lastValidation.value, valid: false }
    }

    if (!userId.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'User ID is required before short-term memory can be used.'
      return { message: lastValidation.value, valid: false }
    }

    if (!baseUrl.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'Base URL is required before remote Mem0 can be used.'
      return { message: lastValidation.value, valid: false }
    }

    if (topK.value < 1) {
      validationStatus.value = 'error'
      lastValidation.value = 'Top K must be at least 1.'
      return { message: lastValidation.value, valid: false }
    }

    if (searchThreshold.value < 0 || searchThreshold.value > 1) {
      validationStatus.value = 'error'
      lastValidation.value = 'Search threshold must stay between 0 and 1.'
      return { message: lastValidation.value, valid: false }
    }

    try {
      const payload = {
        apiKey: apiKey.value.trim(),
        baseUrl: baseUrl.value.trim(),
        userId: userId.value.trim(),
        agentId: agentId.value.trim(),
        runId: runId.value.trim(),
        appId: appId.value.trim(),
        topK: topK.value,
        searchThreshold: searchThreshold.value,
      }
      const desktopValidation = await validateShortTermMemoryOnDesktop(payload)
      const validation = desktopValidation ?? await validateShortTermMemoryRemote(payload)

      validationStatus.value = validation.valid ? 'success' : 'error'
      lastValidation.value = validation.message
      return validation
    }
    catch (error) {
      validationStatus.value = 'error'
      lastValidation.value = errorMessageFrom(error) ?? 'Remote Mem0 validation failed.'
      return { message: lastValidation.value, valid: false }
    }
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

    const payload = {
      apiKey: apiKey.value.trim(),
      appId: appId.value.trim(),
      baseUrl: baseUrl.value.trim(),
      userId: userId.value.trim(),
      agentId: agentId.value.trim(),
      query: trimmedQuery,
      runId: runId.value.trim(),
      topK: topK.value,
    }

    try {
      const [desktopResponse, latestMemoryItems] = await Promise.all([
        searchShortTermMemoryOnDesktop({
          ...payload,
          searchThreshold: searchThreshold.value,
        }),
        fetchLatestMemoryItems(),
      ])

      const finalResults = (desktopResponse?.ok
        ? desktopResponse.items
        : await searchShortTermMemoryRemote(payload).then(results =>
            results
              .filter(item => typeof item.score !== 'number' || item.score >= searchThreshold.value)
              .map(item => ({
                memory: readMem0MemoryText(item),
                score: item.score,
              })),
          ))
        .filter(item => !!item.memory)
        .slice(0, topK.value)

      setRecallDebug({
        at: new Date().toISOString(),
        latestMemoryItems,
        latestMemories: latestMemoryItems.map(item => item.memory),
        matchedItems: finalResults.map(item => ({
          category: 'category' in item ? item.category : undefined,
          conflictKey: 'conflictKey' in item ? item.conflictKey : undefined,
          matchedBy: 'matchedBy' in item ? item.matchedBy : undefined,
          memory: item.memory,
          score: item.score,
        })),
        message: desktopResponse?.message ?? (
          finalResults.length > 0
            ? `Short-term recall matched ${finalResults.length} memory item(s).`
            : 'Short-term recall completed but found no matching memory.'
        ),
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
        captureMode: 'default',
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
        content: message.content.trim(),
        role: message.role,
      }))
      .filter(message => !!message.content)

    if (usableMessages.length === 0) {
      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: 'default',
        message: 'Capture skipped because there was no usable message content.',
        payload: '',
        status: 'skipped',
      })
      return false
    }

    const payload = {
      apiKey: apiKey.value.trim(),
      appId: appId.value.trim(),
      baseUrl: baseUrl.value.trim(),
      userId: userId.value.trim(),
      agentId: agentId.value.trim(),
      messages: usableMessages,
      runId: runId.value.trim(),
    }

    try {
      const desktopResponse = await captureShortTermMemoryOnDesktop(payload)
      const captureItems = desktopResponse?.ok
        ? desktopResponse.items
        : await captureShortTermMemoryRemote(payload)
      const latestMemoryItems = desktopResponse?.latestMemoryItems?.map(item => ({
        category: item.category,
        conflictKey: item.conflictKey,
        id: item.id,
        memory: item.memory,
      })) ?? await fetchLatestMemoryItems()

      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: 'default',
        events: toRuntimeDebugEvents(captureItems),
        latestMemoryItems,
        latestMemories: latestMemoryItems.map(item => item.memory),
        message: desktopResponse?.message ?? (
          captureItems.length > 0
            ? `Short-term capture stored ${captureItems.length} memory item(s).`
            : 'Short-term capture found no stable memory candidate in this turn.'
        ),
        operations: formatCaptureOperations(captureItems),
        payload: usableMessages.map(message => `[${message.role}] ${message.content}`).join('\n'),
        resultCount: captureItems.length,
        status: 'success',
      })
      return true
    }
    catch (error) {
      console.warn('[mem0] capture request failed', errorMessageFrom(error) ?? error)
      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: 'default',
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

    isClearing.value = true

    try {
      const payload = {
        apiKey: apiKey.value.trim(),
        baseUrl: baseUrl.value.trim(),
        userId: userId.value.trim(),
        agentId: agentId.value.trim(),
        runId: runId.value.trim(),
      }
      const latestMemoryItems = await fetchLatestMemoryItems()
      const response = await Promise.race([
        clearShortTermMemoryOnDesktop(payload),
        new Promise<undefined>((resolve) => {
          setTimeout(resolve, shortTermMemoryClearTimeoutMsec, undefined)
        }),
      ])

      if (response) {
        if (!response.ok) {
          throw new Error(response.message || 'Failed to clear short-term memory.')
        }

        setCaptureDebug({
          at: new Date().toISOString(),
          captureMode: 'default',
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
        return
      }

      await clearShortTermMemoryRemote(payload)
      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: 'default',
        events: [],
        latestMemoryItems: [],
        latestMemories: [],
        message: latestMemoryItems.length > 0
          ? `Cleared ${latestMemoryItems.length} short-term memory item(s).`
          : 'Short-term memory is already empty.',
        operations: latestMemoryItems.length > 0
          ? [`CLEAR: deleted ${latestMemoryItems.length} short-term memory item(s)`]
          : undefined,
        payload: `Cleared short-term memory for user ${userId.value.trim()}.`,
        resultCount: latestMemoryItems.length,
        status: 'success',
      })
    }
    catch (error) {
      setCaptureDebug({
        at: new Date().toISOString(),
        captureMode: 'default',
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
    baseUrl.reset()
    apiKey.reset()
    userId.reset()
    agentId.reset()
    runId.reset()
    appId.reset()
    autoRecall.reset()
    autoCapture.reset()
    topK.reset()
    searchThreshold.reset()
    validationStatus.reset()
    lastValidation.reset()
    lastCaptureDebug.reset()
    lastRecallDebug.reset()
  }

  return {
    apiKey,
    appId,
    agentId,
    autoCapture,
    autoRecall,
    backendId,
    baseUrl,
    buildRecallPrompt,
    captureMessages,
    clearShortTermMemory,
    configured,
    enabled,
    isClearing,
    lastCaptureDebug,
    lastRecallDebug,
    lastValidation,
    markRecallSkipped,
    resetState,
    resetValidationState,
    runId,
    runtimeReady,
    searchMemories,
    searchThreshold,
    topK,
    userId,
    validateConfiguration,
    validationStatus,
  }
})
