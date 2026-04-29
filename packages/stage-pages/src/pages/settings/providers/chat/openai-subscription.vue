<script setup lang="ts">
import type { OpenAISubscriptionServerStatus } from '@proj-airi/stage-ui/libs/openai-subscription-auth'

import { errorMessageFrom } from '@moeru/std'
import {
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import {
  fetchOpenAISubscriptionStatus,
  logoutOpenAISubscription,

  startOpenAISubscriptionLogin,
} from '@proj-airi/stage-ui/libs/openai-subscription-auth'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, Callout } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const router = useRouter()
const { t } = useI18n()
const authStore = useAuthStore()
const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const { isAuthenticated, needsLogin } = storeToRefs(authStore)

const providerId = 'openai-subscription'
const providerMetadata = providersStore.getProviderMetadata(providerId)
const status = shallowRef<OpenAISubscriptionServerStatus | null>(null)
const isRefreshingStatus = shallowRef(false)
const isStartingLogin = shallowRef(false)
const isLoggingOut = shallowRef(false)
const actionError = shallowRef('')

const isConnected = computed(() => status.value?.connected === true || !!providersStore.configuredProviders[providerId])

async function refreshStatus() {
  actionError.value = ''

  if (!isAuthenticated.value) {
    status.value = null
    providersStore.setProviderUnconfigured(providerId)
    return
  }

  isRefreshingStatus.value = true
  try {
    status.value = await fetchOpenAISubscriptionStatus()
    if (status.value.connected) {
      providersStore.initializeProvider(providerId)
      providersStore.forceProviderConfigured(providerId)
      await providersStore.fetchModelsForProvider(providerId)
      return
    }

    providersStore.setProviderUnconfigured(providerId)
  }
  catch (error) {
    actionError.value = errorMessageFrom(error) ?? 'Failed to refresh OpenAI subscription status'
  }
  finally {
    isRefreshingStatus.value = false
  }
}

function handleAiriLogin() {
  needsLogin.value = true
}

async function handleLogin() {
  if (!isAuthenticated.value) {
    handleAiriLogin()
    return
  }

  actionError.value = ''
  isStartingLogin.value = true
  try {
    window.location.href = await startOpenAISubscriptionLogin()
  }
  catch (error) {
    actionError.value = errorMessageFrom(error) ?? 'Failed to start OpenAI subscription login'
  }
  finally {
    isStartingLogin.value = false
  }
}

async function handleLogout() {
  actionError.value = ''
  isLoggingOut.value = true
  try {
    await logoutOpenAISubscription()
    status.value = { connected: false }
    await providersStore.disposeProviderInstance(providerId)
    providersStore.setProviderUnconfigured(providerId)
  }
  catch (error) {
    actionError.value = errorMessageFrom(error) ?? 'Failed to disconnect OpenAI subscription'
  }
  finally {
    isLoggingOut.value = false
  }
}

async function handleUseProvider() {
  consciousnessStore.activeProvider = providerId
  consciousnessStore.activeModel = 'gpt-5.4'
  await consciousnessStore.loadModelsForProvider(providerId)
  router.push('/settings/modules/consciousness')
}

onMounted(refreshStatus)

watch(isAuthenticated, () => {
  void refreshStatus()
})
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
      <div :class="['flex', 'flex-col', 'gap-4']">
        <Callout v-if="actionError" theme="orange">
          <template #label>
            {{ t('settings.pages.providers.provider.openai-subscription.title') }}
          </template>
          <p>{{ actionError }}</p>
        </Callout>

        <div v-if="!isAuthenticated" :class="['flex', 'flex-col', 'gap-4']">
          <Callout theme="primary">
            <template #label>
              {{ t('settings.dialogs.onboarding.official.title') }}
            </template>
            <div :class="['flex', 'flex-col', 'gap-3']">
              <p>{{ t('settings.dialogs.onboarding.loginPrompt') }}</p>
              <Button
                :label="t('settings.dialogs.onboarding.loginAction')"
                :loading="isStartingLogin"
                @click="handleAiriLogin"
              />
            </div>
          </Callout>
        </div>

        <div v-else-if="!isConnected" :class="['flex', 'flex-col', 'gap-4']">
          <Callout theme="primary">
            <template #label>
              {{ t('settings.pages.providers.provider.openai-subscription.sign-in.title') }}
            </template>
            <div :class="['flex', 'flex-col', 'gap-3']">
              <p>{{ t('settings.pages.providers.provider.openai-subscription.sign-in.description') }}</p>
              <div :class="['flex', 'flex-wrap', 'gap-2']">
                <Button
                  :label="t('settings.pages.providers.provider.openai-subscription.sign-in.action')"
                  :loading="isStartingLogin"
                  @click="handleLogin"
                />
                <Button
                  variant="secondary"
                  label="Refresh status"
                  :loading="isRefreshingStatus"
                  @click="refreshStatus"
                />
              </div>
            </div>
          </Callout>
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

          <div :class="['flex', 'flex-wrap', 'gap-2']">
            <Button
              :label="t('settings.pages.providers.provider.openai-subscription.ready.action')"
              @click="handleUseProvider"
            />
            <Button
              variant="secondary"
              label="Refresh status"
              :loading="isRefreshingStatus"
              @click="refreshStatus"
            />
            <Button
              variant="danger"
              :label="t('settings.pages.providers.provider.openai-subscription.ready.logout')"
              :loading="isLoggingOut"
              @click="handleLogout"
            />
          </div>
        </div>
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
