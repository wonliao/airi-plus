import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useAiriCardStore } from './airi-card'
import { useConsciousnessStore } from './consciousness'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

describe('useAiriCardStore', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn, stubActions: false }))
  })

  it('seeds default and frieren builtin cards during initialize', () => {
    const store = useAiriCardStore()

    store.initialize()

    expect(store.cards.has('default')).toBe(true)
    expect(store.cards.has('frieren')).toBe(true)
    expect(store.cards.get('frieren')?.name).toBe('Frieren')
    expect(store.cards.get('frieren')?.personality).toContain('冷靜')
  })

  it('backfills frieren without overwriting existing cards', () => {
    const store = useAiriCardStore()

    store.cards.set('default', {
      name: 'ReLU',
      version: '1.0.0',
      description: 'existing default',
      extensions: {
        airi: {
          modules: {
            consciousness: {
              provider: '',
              model: '',
            },
            speech: {
              provider: '',
              model: '',
              voice_id: '',
            },
          },
          agents: {},
        },
      },
    })

    store.initialize()

    expect(store.cards.get('default')?.description).toBe('existing default')
    expect(store.cards.has('frieren')).toBe(true)
  })

  it('falls back to active consciousness config when a card stores blank provider or model', async () => {
    const consciousnessStore = useConsciousnessStore()
    const store = useAiriCardStore()

    consciousnessStore.activeProvider = 'openai'
    consciousnessStore.activeModel = 'gpt-4.1'

    store.cards.set('frieren', {
      name: 'Frieren',
      version: '1.1.0',
      extensions: {
        airi: {
          modules: {
            consciousness: {
              provider: '',
              model: '',
            },
            speech: {
              provider: '',
              model: '',
              voice_id: '',
            },
          },
          agents: {},
        },
      },
    })

    store.activeCardId = 'frieren'
    await nextTick()

    expect(consciousnessStore.activeProvider).toBe('openai')
    expect(consciousnessStore.activeModel).toBe('gpt-4.1')
  })

  it('normalizes stored cards with blank module settings during initialize', () => {
    const consciousnessStore = useConsciousnessStore()
    const store = useAiriCardStore()

    consciousnessStore.activeProvider = 'openai'
    consciousnessStore.activeModel = 'gpt-4.1'

    store.cards.set('legacy-card', {
      name: 'Legacy',
      version: '1.0.0',
      extensions: {
        airi: {
          modules: {
            consciousness: {
              provider: '',
              model: '',
            },
            speech: {
              provider: '',
              model: '',
              voice_id: '',
            },
            displayModelId: '',
          },
          agents: {},
        },
      },
    })

    store.initialize()

    expect(store.cards.get('legacy-card')?.extensions?.airi.modules.consciousness.provider).toBe('openai')
    expect(store.cards.get('legacy-card')?.extensions?.airi.modules.consciousness.model).toBe('gpt-4.1')
  })
})
