import type { MemoryValidationStatus } from './memory-shared'

import { errorMessageFrom } from '@moeru/std'
import { isStageTamagotchi, validateLlmWikiWorkspaceOnDesktop } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

function isAbsolutePath(value: string) {
  return value.startsWith('/') || /^[A-Z]:[\\/]/i.test(value)
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

  const configured = computed(() => {
    if (!enabled.value) {
      return false
    }

    return !!workspacePath.value.trim()
      && !!indexPath.value.trim()
      && !!overviewPath.value.trim()
      && !!queryMode.value.trim()
  })

  function resetValidationState() {
    validationStatus.reset()
    lastValidation.reset()
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
    resetValidationState()
  }

  return {
    enabled,
    backendId,
    configured,
    validationStatus,
    lastValidation,
    workspacePath,
    indexPath,
    overviewPath,
    queryMode,
    allowPromotion,
    manualReviewRequired,
    personaReviewRequired,
    notes,
    validateConfiguration,
    resetValidationState,
    resetState,
  }
})
