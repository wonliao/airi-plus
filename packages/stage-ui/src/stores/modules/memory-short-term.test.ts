import { describe, expect, it } from 'vitest'

import {
  resolveExtractionLlmDefaults,
  resolveShortTermMemoryBackendMode,
} from './memory-short-term'

describe('resolveShortTermMemoryBackendMode', () => {
  it('uses desktop-local mode for Electron managed aliases and local paths', () => {
    expect(resolveShortTermMemoryBackendMode({
      baseUrl: 'mem0',
      stageTamagotchi: true,
    })).toBe('desktop-local')

    expect(resolveShortTermMemoryBackendMode({
      baseUrl: './memory/local',
      stageTamagotchi: true,
    })).toBe('desktop-local')

    expect(resolveShortTermMemoryBackendMode({
      baseUrl: '/tmp/airi-memory',
      stageTamagotchi: true,
    })).toBe('desktop-local')
  })

  it('uses remote-mem0 mode for HTTP endpoints or non-desktop runtimes', () => {
    expect(resolveShortTermMemoryBackendMode({
      baseUrl: 'http://127.0.0.1:8000',
      stageTamagotchi: true,
    })).toBe('remote-mem0')

    expect(resolveShortTermMemoryBackendMode({
      baseUrl: 'mem0',
      stageTamagotchi: false,
    })).toBe('remote-mem0')
  })
})

describe('resolveExtractionLlmDefaults', () => {
  it('falls back to consciousness provider and model when extraction settings are empty', () => {
    expect(resolveExtractionLlmDefaults({
      currentProvider: '',
      currentModel: '',
      consciousnessProvider: 'openai-subscription',
      consciousnessModel: 'gpt-5.4',
    })).toEqual({
      provider: 'openai-subscription',
      model: 'gpt-5.4',
    })
  })

  it('preserves explicit extraction settings when they already exist', () => {
    expect(resolveExtractionLlmDefaults({
      currentProvider: 'deepseek',
      currentModel: 'deepseek-chat',
      consciousnessProvider: 'openai-subscription',
      consciousnessModel: 'gpt-5.4',
    })).toEqual({
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
  })
})
