import type { MemoryValidationStatus } from './memory-shared'

import { errorMessageFrom } from '@moeru/std'
import { isStageTamagotchi, queryLlmWikiOnDesktop, validateLlmWikiWorkspaceOnDesktop } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

function isAbsolutePath(value: string) {
  return value.startsWith('/') || /^[A-Z]:[\\/]/i.test(value)
}

interface LlmWikiRuntimeDebugEntry {
  at: string
  latestSources?: string[]
  message: string
  payload: string
  resultCount?: number
  status: 'error' | 'skipped' | 'success'
}

interface LlmWikiQueryResultItem {
  path: string
  score: number
  title: string
  excerpt: string
}

function buildLlmWikiRecallPrompt(items: LlmWikiQueryResultItem[]) {
  if (items.length === 0) {
    return ''
  }

  return [
    'These are long-term knowledge snippets recalled from llm-wiki.',
    'Use them when the user is asking about stable world knowledge, documented entities, or background facts.',
    'When you rely on them, prefer concise answers and mention the page title naturally when it helps.',
    ...items.map((item, index) => `${index + 1}. [${item.title}] (${item.path}) ${item.excerpt}`),
  ].join('\n')
}

export const useLongTermMemoryStore = defineStore('memory-long-term', () => {
  const enabled = useLocalStorageManualReset<boolean>('settings/memory/long-term/enabled', false)
  const backendId = useLocalStorageManualReset<string>('settings/memory/long-term/backend-id', 'llm-wiki')
  const validationStatus = useLocalStorageManualReset<MemoryValidationStatus>('settings/memory/long-term/validation-status', 'idle')
  const lastValidation = useLocalStorageManualReset<string>('settings/memory/long-term/last-validation', '')

  const workspacePath = useLocalStorageManualReset<string>('settings/memory/long-term/workspace-path', '')
  const indexPath = useLocalStorageManualReset<string>('settings/memory/long-term/index-path', 'index.md')
  const overviewPath = useLocalStorageManualReset<string>('settings/memory/long-term/overview-path', 'wiki/overview.md')
  const queryMode = useLocalStorageManualReset<string>('settings/memory/long-term/query-mode', 'digest')
  const allowPromotion = useLocalStorageManualReset<boolean>('settings/memory/long-term/allow-promotion', false)
  const manualReviewRequired = useLocalStorageManualReset<boolean>('settings/memory/long-term/manual-review-required', true)
  const personaReviewRequired = useLocalStorageManualReset<boolean>('settings/memory/long-term/persona-review-required', true)
  const notes = useLocalStorageManualReset<string>('settings/memory/long-term/notes', '')
  const lastRecallDebug = useLocalStorageManualReset<LlmWikiRuntimeDebugEntry | null>('settings/memory/long-term/debug/last-recall', null)

  const configured = computed(() => {
    if (!enabled.value) {
      return false
    }

    return !!workspacePath.value.trim()
      && !!indexPath.value.trim()
      && !!overviewPath.value.trim()
      && !!queryMode.value.trim()
  })
  const runtimeReady = computed(() => enabled.value && configured.value && validationStatus.value === 'success' && isStageTamagotchi())

  function resetValidationState() {
    validationStatus.reset()
    lastValidation.reset()
  }

  function setRecallDebug(entry: LlmWikiRuntimeDebugEntry) {
    lastRecallDebug.value = entry
  }

  async function validateConfiguration() {
    if (!enabled.value) {
      validationStatus.value = 'idle'
      lastValidation.value = 'Long-term memory is disabled.'
      return { valid: false, message: lastValidation.value }
    }

    if (!workspacePath.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'Workspace path is required before llm-wiki can be used.'
      return { valid: false, message: lastValidation.value }
    }

    if (!isAbsolutePath(workspacePath.value.trim())) {
      validationStatus.value = 'error'
      lastValidation.value = 'Workspace path should be an absolute path so runtime integrations can resolve it reliably.'
      return { valid: false, message: lastValidation.value }
    }

    if (!indexPath.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'Index path is required before llm-wiki can be validated.'
      return { valid: false, message: lastValidation.value }
    }

    if (!overviewPath.value.trim()) {
      validationStatus.value = 'error'
      lastValidation.value = 'Overview path is required before llm-wiki can be validated.'
      return { valid: false, message: lastValidation.value }
    }

    if (queryMode.value !== 'digest' && queryMode.value !== 'query' && queryMode.value !== 'hybrid') {
      validationStatus.value = 'error'
      lastValidation.value = 'Query mode must be digest, query, or hybrid.'
      return { valid: false, message: lastValidation.value }
    }

    if (isAbsolutePath(indexPath.value.trim()) && !indexPath.value.trim().startsWith(workspacePath.value.trim())) {
      validationStatus.value = 'error'
      lastValidation.value = 'Absolute index path must live inside the configured workspace path.'
      return { valid: false, message: lastValidation.value }
    }

    if (isAbsolutePath(overviewPath.value.trim()) && !overviewPath.value.trim().startsWith(workspacePath.value.trim())) {
      validationStatus.value = 'error'
      lastValidation.value = 'Absolute overview path must live inside the configured workspace path.'
      return { valid: false, message: lastValidation.value }
    }

    if (isStageTamagotchi()) {
      try {
        const desktopValidation = await validateLlmWikiWorkspaceOnDesktop({
          workspacePath: workspacePath.value.trim(),
          indexPath: indexPath.value.trim(),
          overviewPath: overviewPath.value.trim(),
        })

        if (desktopValidation) {
          validationStatus.value = desktopValidation.valid ? 'success' : 'error'
          lastValidation.value = desktopValidation.message
          return { valid: desktopValidation.valid, message: desktopValidation.message }
        }
      }
      catch (error) {
        validationStatus.value = 'error'
        lastValidation.value = errorMessageFrom(error) ?? 'Desktop llm-wiki validation failed.'
        return { valid: false, message: lastValidation.value }
      }
    }

    validationStatus.value = 'success'
    lastValidation.value = 'llm-wiki configuration looks ready for first-release integration.'
    return { valid: true, message: lastValidation.value }
  }

  async function queryWiki(query: string) {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      setRecallDebug({
        at: new Date().toISOString(),
        message: 'llm-wiki recall skipped because the query is empty.',
        payload: '',
        status: 'skipped',
      })
      return []
    }

    if (!runtimeReady.value) {
      setRecallDebug({
        at: new Date().toISOString(),
        message: 'llm-wiki recall skipped because long-term memory is not runtime-ready.',
        payload: trimmedQuery,
        status: 'skipped',
      })
      return []
    }

    try {
      const response = await queryLlmWikiOnDesktop({
        workspacePath: workspacePath.value.trim(),
        indexPath: indexPath.value.trim(),
        overviewPath: overviewPath.value.trim(),
        query: trimmedQuery,
        queryMode: queryMode.value as 'digest' | 'hybrid' | 'query',
        maxResults: 4,
      })

      if (!response) {
        setRecallDebug({
          at: new Date().toISOString(),
          message: 'llm-wiki recall is unavailable in this runtime.',
          payload: trimmedQuery,
          status: 'skipped',
        })
        return []
      }

      setRecallDebug({
        at: new Date().toISOString(),
        latestSources: response.items.map(item => `${item.title} (${item.path})`).slice(0, 6),
        message: response.message,
        payload: trimmedQuery,
        resultCount: response.items.length,
        status: response.ok ? 'success' : 'error',
      })

      return response.ok ? response.items : []
    }
    catch (error) {
      setRecallDebug({
        at: new Date().toISOString(),
        message: errorMessageFrom(error) ?? 'llm-wiki recall failed.',
        payload: trimmedQuery,
        status: 'error',
      })
      return []
    }
  }

  async function buildRecallPrompt(query: string) {
    const items = await queryWiki(query)
    const prompt = buildLlmWikiRecallPrompt(items)
    if (!prompt) {
      return null
    }

    return {
      items,
      prompt,
      query: query.trim(),
    }
  }

  function resetState() {
    enabled.reset()
    backendId.reset()
    workspacePath.reset()
    indexPath.reset()
    overviewPath.reset()
    queryMode.reset()
    allowPromotion.reset()
    manualReviewRequired.reset()
    personaReviewRequired.reset()
    notes.reset()
    lastRecallDebug.reset()
    resetValidationState()
  }

  return {
    enabled,
    backendId,
    configured,
    validationStatus,
    lastValidation,
    lastRecallDebug,
    runtimeReady,
    workspacePath,
    indexPath,
    overviewPath,
    queryMode,
    allowPromotion,
    manualReviewRequired,
    personaReviewRequired,
    notes,
    buildRecallPrompt,
    queryWiki,
    validateConfiguration,
    resetValidationState,
    resetState,
  }
})
