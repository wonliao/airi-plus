import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import {
  createOpenAISubscriptionFetch,
  getStoredOpenAISubscriptionTokens,
  OPENAI_SUBSCRIPTION_ALLOWED_MODELS,
} from '../../../../libs/openai-subscription-auth'
import { defineProvider } from '../registry'

const openAISubscriptionConfigSchema = z.object({})

const OPENAI_SUBSCRIPTION_BASE_URL = 'https://api.openai.com/v1'

export const providerOpenAISubscription = defineProvider({
  id: 'openai-subscription',
  order: 6,
  name: 'OpenAI (Subscription)',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.openai-subscription.title'),
  description: 'Experimental ChatGPT subscription integration for desktop AIRI.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.openai-subscription.description'),
  tasks: ['chat'],
  icon: 'i-lobe-icons:openai',
  requiresCredentials: false,
  isAvailableBy: isStageTamagotchi,

  createProviderConfig: () => openAISubscriptionConfigSchema,
  createProvider(_config) {
    const provider = createOpenAI('openai-subscription-oauth', OPENAI_SUBSCRIPTION_BASE_URL)
    const originalChat = provider.chat.bind(provider)
    provider.chat = (model: string) => {
      const result = originalChat(model)
      result.fetch = createOpenAISubscriptionFetch()
      return result
    }
    return provider
  },

  validationRequiredWhen: () => true,
  validators: {
    validateConfig: [
      ({ t }) => ({
        id: 'openai-subscription:check-login',
        name: t('settings.pages.providers.provider.openai-subscription.validation.check-login.title'),
        validator: async () => {
          const tokens = getStoredOpenAISubscriptionTokens()
          if (tokens?.refreshToken) {
            return {
              errors: [],
              reason: '',
              reasonKey: '',
              valid: true,
            }
          }

          return {
            errors: [{
              error: new Error(t('settings.pages.providers.provider.openai-subscription.validation.check-login.reason')),
              errorKey: 'settings.pages.providers.provider.openai-subscription.validation.check-login.reason',
            }],
            reason: t('settings.pages.providers.provider.openai-subscription.validation.check-login.reason'),
            reasonKey: 'settings.pages.providers.provider.openai-subscription.validation.check-login.reason',
            valid: false,
          }
        },
      }),
    ],
  },

  disableChatPingCheckUI: true,

  extraMethods: {
    listModels: async () => OPENAI_SUBSCRIPTION_ALLOWED_MODELS.map(modelId => ({
      id: modelId,
      name: modelId,
      provider: 'openai-subscription',
      description: 'Experimental Codex / ChatGPT subscription model.',
    })),
  },
})
