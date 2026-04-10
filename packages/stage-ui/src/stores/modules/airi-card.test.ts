import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAiriCardStore } from './airi-card'

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
})
