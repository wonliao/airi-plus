<script setup lang="ts">
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import {
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Callout } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const router = useRouter()
const { t } = useI18n()
const providersStore = useProvidersStore()

const providerId = 'openai-subscription'
const providerMetadata = providersStore.getProviderMetadata(providerId)
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
        <Callout theme="primary">
          <template #label>
            {{ t('settings.pages.providers.provider.openai-subscription.unsupported.title') }}
          </template>
          <p>{{ t('settings.pages.providers.provider.openai-subscription.unsupported.description') }}</p>
        </Callout>

        <div :class="['rounded-xl', 'border', 'border-neutral-200/60', 'bg-neutral-50/80', 'p-4', 'dark:border-neutral-700/60', 'dark:bg-neutral-900/40']">
          <div :class="['text-sm', 'font-semibold', 'text-neutral-700', 'dark:text-neutral-100']">
            {{ t('settings.pages.providers.provider.openai-subscription.comparison.title') }}
          </div>
          <p :class="['mt-2', 'text-sm', 'text-neutral-600', 'dark:text-neutral-300']">
            {{ isStageTamagotchi() ? t('settings.pages.providers.provider.openai-subscription.sign-in.experimentalDescription') : t('settings.pages.providers.provider.openai-subscription.unsupported.description') }}
          </p>
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
