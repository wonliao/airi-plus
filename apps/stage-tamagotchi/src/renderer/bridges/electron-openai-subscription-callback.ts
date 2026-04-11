import { getElectronEventaContext } from '@proj-airi/electron-vueuse'
import {
  clearStoredOpenAISubscriptionTokens,
  setStoredOpenAISubscriptionTokens,
} from '@proj-airi/stage-ui/libs/openai-subscription-auth'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { toast } from 'vue-sonner'

import {
  electronOpenAISubscriptionAuthCallback,
  electronOpenAISubscriptionAuthCallbackError,
} from '../../shared/eventa'

const PROVIDER_ID = 'openai-subscription'

export function initializeElectronOpenAISubscriptionCallbackBridge() {
  const context = getElectronEventaContext()

  context.on(electronOpenAISubscriptionAuthCallback, async (event) => {
    const tokens = event.body
    if (!tokens)
      return

    setStoredOpenAISubscriptionTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
    })

    const providersStore = useProvidersStore()
    providersStore.initializeProvider(PROVIDER_ID)
    providersStore.forceProviderConfigured(PROVIDER_ID)
    await providersStore.disposeProviderInstance(PROVIDER_ID)
    await providersStore.fetchModelsForProvider(PROVIDER_ID)
    toast.success('OpenAI subscription connected')
  })

  context.on(electronOpenAISubscriptionAuthCallbackError, async (event) => {
    const providersStore = useProvidersStore()
    clearStoredOpenAISubscriptionTokens()
    await providersStore.disposeProviderInstance(PROVIDER_ID)
    providersStore.setProviderUnconfigured(PROVIDER_ID)
    if (event.body) {
      toast.error(event.body.error)
    }
  })
}
