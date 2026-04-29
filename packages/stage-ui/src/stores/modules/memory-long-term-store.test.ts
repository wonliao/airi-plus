import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useLongTermMemoryStore } from './memory-long-term'

const { ensureDefaultLlmWikiWorkspaceOnDesktop } = vi.hoisted(() => ({
  ensureDefaultLlmWikiWorkspaceOnDesktop: vi.fn(),
}))

vi.mock('@proj-airi/stage-shared', () => ({
  ensureDefaultLlmWikiWorkspaceOnDesktop,
  isAbsoluteFilesystemPath: (value: string) => value.startsWith('/'),
  isElectronManagedMemoryAlias: (value: string, kind: string) => value.trim().toLowerCase() === kind,
  isElectronManagedRelativePath: (value: string) => {
    const trimmed = value.trim()
    return !!trimmed && !trimmed.startsWith('/')
  },
  isStageTamagotchi: () => true,
  queryLlmWikiOnDesktop: vi.fn(),
  validateLlmWikiWorkspaceOnDesktop: vi.fn(),
}))

vi.mock('@proj-airi/stage-shared/composables', () => ({
  useLocalStorageManualReset: <T>(_key: string, initialValue: T) => {
    const state = ref(initialValue)
    return Object.assign(state, {
      reset() {
        state.value = initialValue
      },
    })
  },
}))

describe('useLongTermMemoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ensureDefaultLlmWikiWorkspaceOnDesktop.mockReset()
  })

  it('normalizes persisted desktop paths back to the AIRI-managed workspace', async () => {
    ensureDefaultLlmWikiWorkspaceOnDesktop.mockResolvedValue({
      initialized: false,
      indexPath: '/managed/llm-wiki/index.md',
      overviewPath: '/managed/llm-wiki/wiki/overview.md',
      workspacePath: '/managed/llm-wiki',
    })

    const store = useLongTermMemoryStore()
    store.workspacePath = '/custom/wiki'
    store.indexPath = '/custom/wiki/custom-index.md'
    store.overviewPath = '/custom/wiki/custom-overview.md'

    await store.ensureDefaultWorkspace()

    expect(store.workspacePath).toBe('/managed/llm-wiki')
    expect(store.indexPath).toBe('/managed/llm-wiki/index.md')
    expect(store.overviewPath).toBe('/managed/llm-wiki/wiki/overview.md')
  })
})
