import { describe, expect, it } from 'vitest'

import { shouldUseFrierenSpeechByDefault, toSignedPercent } from './speech'

describe('speech store helpers', () => {
  it('formats positive percentages with a plus sign', () => {
    expect(toSignedPercent(25)).toBe('+25%')
  })

  it('formats negative percentages without a double minus', () => {
    expect(toSignedPercent(-20)).toBe('-20%')
    expect(toSignedPercent(-20)).not.toContain('--')
  })

  it('formats zero as 0%', () => {
    expect(toSignedPercent(0)).toBe('0%')
  })

  it('defaults desktop speech to Frieren sidecar when no speech provider is selected', () => {
    expect(shouldUseFrierenSpeechByDefault({
      isDesktop: true,
      activeProvider: 'speech-noop',
      configuredProviderIds: ['frieren-rvc-sidecar'],
    })).toBe(true)
  })

  it('does not override an existing speech provider selection', () => {
    expect(shouldUseFrierenSpeechByDefault({
      isDesktop: true,
      activeProvider: 'elevenlabs',
      configuredProviderIds: ['frieren-rvc-sidecar', 'elevenlabs'],
    })).toBe(false)
  })

  it('does not default to Frieren outside desktop runtime', () => {
    expect(shouldUseFrierenSpeechByDefault({
      isDesktop: false,
      activeProvider: 'speech-noop',
      configuredProviderIds: ['frieren-rvc-sidecar'],
    })).toBe(false)
  })
})
