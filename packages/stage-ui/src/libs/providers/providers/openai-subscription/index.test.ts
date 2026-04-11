import { describe, expect, it, vi } from 'vitest'

import { providerOpenAISubscription } from './index'

const {
  getStoredOpenAISubscriptionTokensMock,
} = vi.hoisted(() => ({
  getStoredOpenAISubscriptionTokensMock: vi.fn(),
}))

vi.mock('../../../../libs/openai-subscription-auth', () => ({
  OPENAI_SUBSCRIPTION_ALLOWED_MODELS: ['gpt-5.4'],
  createOpenAISubscriptionFetch: vi.fn(),
  getStoredOpenAISubscriptionTokens: getStoredOpenAISubscriptionTokensMock,
}))

describe('providerOpenAISubscription login validator', () => {
  const validator = providerOpenAISubscription.validators?.validateConfig?.[0]({
    t: (key: string) => key,
  })

  it('passes when an auth token exists', async () => {
    getStoredOpenAISubscriptionTokensMock.mockReturnValue({
      accessToken: 'token-123',
      refreshToken: 'refresh-123',
      expiresAt: Date.now() + 60_000,
    })

    const result = await validator?.validator({}, { t: (key: string) => key })

    expect(result?.valid).toBe(true)
  })

  it('fails when the user is not signed in', async () => {
    getStoredOpenAISubscriptionTokensMock.mockReturnValue(null)

    const result = await validator?.validator({}, { t: (key: string) => key })

    expect(result?.valid).toBe(false)
    expect(result?.reason).toContain('settings.pages.providers.provider.openai-subscription.validation.check-login.reason')
  })
})
