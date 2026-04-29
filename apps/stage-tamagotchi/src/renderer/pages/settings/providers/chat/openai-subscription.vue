<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import {
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import {
  OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY,
} from '@proj-airi/stage-ui/libs/openai-subscription-auth'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, Callout } from '@proj-airi/ui'
import { StorageSerializers, useLocalStorage } from '@vueuse/core'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import {
  electronOpenAISubscriptionAuthLogout,
  electronOpenAISubscriptionAuthStartLogin,
} from '../../../../../shared/eventa'

const router = useRouter()
const { t } = useI18n()
const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const startLogin = useElectronEventaInvoke(electronOpenAISubscriptionAuthStartLogin)
const logout = useElectronEventaInvoke(electronOpenAISubscriptionAuthLogout)

const providerId = 'openai-subscription'
const providerMetadata = providersStore.getProviderMetadata(providerId)
const storedTokens = useLocalStorage<{ refreshToken?: string } | null>(OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY, null, {
  serializer: StorageSerializers.object,
})
const isConnected = computed(() => !!storedTokens.value?.refreshToken || !!providersStore.configuredProviders[providerId])

onMounted(async () => {
  if (!storedTokens.value?.refreshToken) {
    providersStore.setProviderUnconfigured(providerId)
    return
  }

  providersStore.initializeProvider(providerId)
  providersStore.forceProviderConfigured(providerId)
  await providersStore.fetchModelsForProvider(providerId)
})

async function handleLogin() {
  await startLogin()
}

async function handleLogout() {
  storedTokens.value = null
  await logout()
  await providersStore.disposeProviderInstance(providerId)
  providersStore.setProviderUnconfigured(providerId)
}

async function handleUseProvider() {
  consciousnessStore.activeProvider = providerId
  consciousnessStore.activeModel = 'gpt-5.4'
  await consciousnessStore.loadModelsForProvider(providerId)
  router.push('/settings/modules/consciousness')
}
</script>

<template>
  <ProviderSettingsLayout
    v-if="providerMetadata"
    :provider-name="providerMetadata.localizedName"
    :provider-icon="providerMetadata.icon"
    :provider-icon-color="providerMetadata.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <div v-if="!isConnected" :class="['flex', 'flex-col', 'gap-4']">
        <Callout theme="primary">
          <template #label>
            {{ t('settings.pages.providers.provider.openai-subscription.sign-in.title') }}
          </template>
          <div :class="['flex', 'flex-col', 'gap-3']">
            <p>{{ t('settings.pages.providers.provider.openai-subscription.sign-in.description') }}</p>
            <p :class="['text-sm', 'text-neutral-600', 'dark:text-neutral-300']">
              {{ t('settings.pages.providers.provider.openai-subscription.sign-in.experimentalDescription') }}
            </p>
            <button
              type="button"
              :class="['w-fit', 'rounded-lg', 'bg-primary-500', 'px-4', 'py-2', 'text-white', 'transition-colors', 'active:scale-95', 'hover:bg-primary-600']"
              @click="handleLogin"
            >
              {{ t('settings.pages.providers.provider.openai-subscription.sign-in.action') }}
            </button>
          </div>
        </Callout>

        <div :class="['rounded-xl', 'border', 'border-neutral-200/60', 'bg-neutral-50/80', 'p-4', 'dark:border-neutral-700/60', 'dark:bg-neutral-900/40']">
          <div :class="['mb-3', 'text-sm', 'font-semibold', 'text-neutral-700', 'dark:text-neutral-100']">
            {{ t('settings.pages.providers.provider.openai-subscription.comparison.title') }}
          </div>

          <div :class="['flex', 'flex-col', 'gap-3']">
            <div :class="['rounded-lg', 'border', 'border-neutral-200/60', 'bg-white/80', 'p-3', 'dark:border-neutral-700/50', 'dark:bg-neutral-950/40']">
              <div :class="['text-sm', 'font-medium', 'text-neutral-800', 'dark:text-neutral-100']">
                {{ t('settings.pages.providers.provider.openai-subscription.comparison.api.title') }}
              </div>
              <p :class="['mt-1', 'text-sm', 'text-neutral-600', 'dark:text-neutral-300']">
                {{ t('settings.pages.providers.provider.openai-subscription.comparison.api.description') }}
              </p>
            </div>

            <div :class="['rounded-lg', 'border', 'border-primary-200/70', 'bg-primary-50/80', 'p-3', 'dark:border-primary-700/50', 'dark:bg-primary-950/20']">
              <div :class="['text-sm', 'font-medium', 'text-neutral-800', 'dark:text-neutral-100']">
                {{ t('settings.pages.providers.provider.openai-subscription.comparison.subscription.title') }}
              </div>
              <p :class="['mt-1', 'text-sm', 'text-neutral-600', 'dark:text-neutral-300']">
                {{ t('settings.pages.providers.provider.openai-subscription.comparison.subscription.description') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div v-else :class="['flex', 'flex-col', 'gap-6']">
        <Callout theme="primary">
          <template #label>
            {{ t('settings.pages.providers.provider.openai-subscription.ready.title') }}
          </template>
          <p>{{ t('settings.pages.providers.provider.openai-subscription.ready.description') }}</p>
        </Callout>

        <div :class="['border', 'border-neutral-200/50', 'rounded-xl', 'p-4', 'dark:border-neutral-700/50']">
          <div :class="['flex', 'items-center', 'gap-3']">
            <div :class="['h-2', 'w-2', 'animate-pulse', 'rounded-full', 'bg-green-500']" />
            <span :class="['text-sm', 'text-neutral-600', 'dark:text-neutral-300']">
              {{ t('settings.pages.providers.provider.common.status.valid') }}
            </span>
          </div>
        </div>

        <div :class="['rounded-xl', 'border', 'border-neutral-200/60', 'bg-neutral-50/80', 'p-4', 'dark:border-neutral-700/60', 'dark:bg-neutral-900/40']">
          <div :class="['text-sm', 'font-semibold', 'text-neutral-700', 'dark:text-neutral-100']">
            {{ t('settings.pages.providers.provider.openai-subscription.ready.tipTitle') }}
          </div>
          <p :class="['mt-2', 'text-sm', 'text-neutral-600', 'dark:text-neutral-300']">
            {{ t('settings.pages.providers.provider.openai-subscription.ready.tipDescription') }}
          </p>
        </div>

        <Button
          :label="t('settings.pages.providers.provider.openai-subscription.ready.action')"
          @click="handleUseProvider"
        />
        <Button
          variant="secondary"
          :label="t('settings.pages.providers.provider.openai-subscription.ready.logout')"
          @click="handleLogout"
        />
      </div>
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
