import { beforeEach, describe, expect, it, vi } from 'vitest'

import { providerOpenAISubscription } from './index'

const {
  hasOpenAISubscriptionLoginMock,
  isStageTamagotchiMock,
  isStageWebMock,
} = vi.hoisted(() => ({
  hasOpenAISubscriptionLoginMock: vi.fn(),
  isStageTamagotchiMock: vi.fn(),
  isStageWebMock: vi.fn(),
}))

vi.mock('@proj-airi/stage-shared', () => ({
  isStageTamagotchi: isStageTamagotchiMock,
  isStageWeb: isStageWebMock,
}))

vi.mock('../../../../libs/openai-subscription-auth', () => ({
  OPENAI_SUBSCRIPTION_ALLOWED_MODELS: ['gpt-5.4'],
  createOpenAISubscriptionFetch: vi.fn(),
  hasOpenAISubscriptionLogin: hasOpenAISubscriptionLoginMock,
}))

describe('providerOpenAISubscription login validator', () => {
  const validator = providerOpenAISubscription.validators?.validateConfig?.[0]({
    t: (key: string) => key,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
  })

  it('is available on web and desktop runtimes', () => {
    isStageWebMock.mockReturnValue(true)
    isStageTamagotchiMock.mockReturnValue(false)
    expect(providerOpenAISubscription.isAvailableBy?.()).toBe(true)

    isStageWebMock.mockReturnValue(false)
    isStageTamagotchiMock.mockReturnValue(true)
    expect(providerOpenAISubscription.isAvailableBy?.()).toBe(true)
  })

  it('passes when an auth token exists', async () => {
    hasOpenAISubscriptionLoginMock.mockResolvedValue(true)

    const result = await validator?.validator({}, { t: (key: string) => key })

    expect(result?.valid).toBe(true)
  })

  it('fails when the user is not signed in', async () => {
    hasOpenAISubscriptionLoginMock.mockResolvedValue(false)

    const result = await validator?.validator({}, { t: (key: string) => key })

    expect(result?.valid).toBe(false)
    expect(result?.reason).toContain('settings.pages.providers.provider.openai-subscription.validation.check-login.reason')
  })
})
