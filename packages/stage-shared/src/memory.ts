import { defineInvoke, defineInvokeEventa } from '@moeru/eventa'

import { isElectronWindow } from './window'

export interface LlmWikiWorkspaceValidationPayload {
  workspacePath: string
  indexPath: string
  overviewPath: string
}

export interface LlmWikiWorkspaceValidationResult {
  valid: boolean
  message: string
  resolvedWorkspacePath: string
  resolvedIndexPath: string
  resolvedOverviewPath: string
}

export const electronValidateLlmWikiWorkspace = defineInvokeEventa<LlmWikiWorkspaceValidationResult, LlmWikiWorkspaceValidationPayload>('eventa:invoke:electron:memory:llm-wiki:validate-workspace')

export async function validateLlmWikiWorkspaceOnDesktop(payload: LlmWikiWorkspaceValidationPayload) {
  if (typeof window === 'undefined' || !isElectronWindow(window)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(window.electron.ipcRenderer)
  const validateWorkspace = defineInvoke(context, electronValidateLlmWikiWorkspace)

  return validateWorkspace(payload)
}
