<script setup lang="ts">
import type { FrierenSpeechDualLlmTestResult, FrierenSpeechSidecarStatusResult } from '@proj-airi/stage-shared'
import type { RemovableRef } from '@vueuse/core'
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import { errorMessageFrom } from '@moeru/std'
import {
  getFrierenSpeechSidecarStatusOnDesktop,
  importFrierenSpeechSidecarConfigOnDesktop,
  installFrierenSpeechSidecarOnDesktop,
  restartFrierenSpeechSidecarOnDesktop,
  testFrierenSpeechDualLlmOnDesktop,
} from '@proj-airi/stage-shared'
import {
  Alert,
  ProviderValidationAlerts,
  SpeechPlayground,
  SpeechProviderSettings,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, FieldInput, FieldRange } from '@proj-airi/ui'
import { useDebounceFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const providerId = 'frieren-rvc-sidecar'
const defaultModel = 'frieren-rvc'
const defaultVoice = 'frieren'
const defaultBaseUrl = 'http://127.0.0.1:8010/v1/'
const defaultDualLlmBaseUrl = 'https://api.openai.com/v1/'
const defaultDualLlmModel = 'gpt-4.1-mini'
const defaultVoiceSettings = {
  speed: 1.0,
}

const speechStore = useSpeechStore()
const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore) as { providers: RemovableRef<Record<string, any>> }
const { t } = useI18n()

const availableVoices = computed(() => {
  return speechStore.availableVoices[providerId] || []
})

const baseUrl = computed(() => {
  return providers.value[providerId]?.baseUrl as string | undefined || defaultBaseUrl
})

const bridgeDir = computed({
  get: () => providers.value[providerId]?.bridgeDir as string | undefined || '',
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].bridgeDir = value
  },
})

const envFile = computed({
  get: () => providers.value[providerId]?.envFile as string | undefined || '',
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].envFile = value
  },
})

const dualLlmApiKey = computed({
  get: () => providers.value[providerId]?.dualLlmApiKey as string | undefined || '',
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].dualLlmApiKey = value
  },
})

const dualLlmBaseUrl = computed({
  get: () => providers.value[providerId]?.dualLlmBaseUrl as string | undefined || defaultDualLlmBaseUrl,
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].dualLlmBaseUrl = value
  },
})

const dualLlmModel = computed({
  get: () => providers.value[providerId]?.dualLlmModel as string | undefined || defaultDualLlmModel,
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].dualLlmModel = value
  },
})

const kokoroProjectDir = computed({
  get: () => providers.value[providerId]?.kokoroProjectDir as string | undefined || '',
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].kokoroProjectDir = value
  },
})

const rvcModelPath = computed({
  get: () => providers.value[providerId]?.rvcModelPath as string | undefined || '',
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].rvcModelPath = value
  },
})

const rvcIndexPath = computed({
  get: () => providers.value[providerId]?.rvcIndexPath as string | undefined || '',
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].rvcIndexPath = value
  },
})

const speed = computed<number>({
  get: () => providers.value[providerId]?.voiceSettings?.speed as number | undefined || defaultVoiceSettings.speed,
  set: (value) => {
    if (!providers.value[providerId]) {
      providers.value[providerId] = {}
    }

    providers.value[providerId].voiceSettings = {
      ...providers.value[providerId].voiceSettings,
      speed: value,
    }
  },
})

const voicesLoading = ref(false)
const sidecarStatus = ref<FrierenSpeechSidecarStatusResult>()
const sidecarStatusLoading = ref(false)
const sidecarActionLoading = ref<'import' | 'install' | 'restart' | 'test-dual-llm' | null>(null)
const configImportMessage = ref('')
const dualLlmTestResult = ref<FrierenSpeechDualLlmTestResult>()

const {
  router,
  isValidating,
  isValid,
  validationMessage,
  handleResetSettings,
  forceValid,
  hasManualValidators,
  isManualTesting,
  manualTestPassed,
  manualTestMessage,
  runManualTest,
} = useProviderValidation(providerId)

const sidecarConfigured = computed(() => {
  return isValid.value || providersStore.configuredProviders[providerId] === true
})

const resolvedLaunchMode = computed(() => {
  return sidecarStatus.value?.launchMode || (bridgeDir.value.trim() ? 'external' : 'bundled')
})

const sidecarStatusAlertType = computed<'error' | 'warning' | 'success' | 'info' | 'loading'>(() => {
  if (
    resolvedLaunchMode.value === 'bundled'
    && sidecarStatus.value
    && sidecarStatus.value.status !== 'invalid'
    && sidecarStatus.value.dualLlmApiKeyConfigured === false
  ) {
    return 'warning'
  }

  switch (sidecarStatus.value?.status) {
    case 'invalid':
      return 'error'
    case 'missing-config':
    case 'missing-env-file':
    case 'needs-install':
      return 'warning'
    case 'running':
      return 'success'
    case 'ready':
      return 'info'
    default:
      return 'loading'
  }
})

const sidecarStatusTitle = computed(() => {
  const status = sidecarStatus.value?.status ?? 'ready'
  return t(`settings.pages.providers.provider.frieren-rvc-sidecar.runtime.states.${status}`)
})

const sidecarModeLabel = computed(() => {
  return t(`settings.pages.providers.provider.frieren-rvc-sidecar.runtime.modes.${resolvedLaunchMode.value}`)
})

const sidecarRuntimeDetails = computed(() => {
  const status = sidecarStatus.value
  if (!status) {
    return []
  }

  const details = [
    {
      label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.mode'),
      value: sidecarModeLabel.value,
    },
    {
      label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.base-url'),
      value: status.validatedBaseUrl,
    },
  ]

  if (status.launchMode === 'bundled') {
    details.push({
      label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.dual-llm-api-key'),
      value: status.dualLlmApiKeyConfigured
        ? t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.presence.present')
        : t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.presence.missing'),
    })

    if (status.dualLlmBaseUrl) {
      details.push({
        label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.dual-llm-base-url'),
        value: status.dualLlmBaseUrl,
      })
    }

    if (status.dualLlmModel) {
      details.push({
        label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.dual-llm-model'),
        value: status.dualLlmModel,
      })
    }
  }

  if (status.launchMode === 'external') {
    details.push({
      label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.bridge-dir'),
      value: status.resolvedBridgeDir,
    })
  }
  else {
    if (status.runtimeRootPath) {
      details.push({
        label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.runtime-root'),
        value: status.runtimeRootPath,
      })
    }

    if (status.sourcePath) {
      details.push({
        label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.source-path'),
        value: status.sourcePath,
      })
    }

    if (status.venvPath) {
      details.push({
        label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.venv-path'),
        value: status.venvPath,
      })
    }

    if (status.bootstrapLogPath) {
      details.push({
        label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.bootstrap-log'),
        value: status.bootstrapLogPath,
      })
    }
  }

  if (status.resolvedEnvFile) {
    details.push({
      label: t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.details.env-file'),
      value: status.resolvedEnvFile,
    })
  }

  return details
})

const canInstallOrRepair = computed(() => {
  return resolvedLaunchMode.value === 'bundled'
})

const canImportFromEnvFile = computed(() => {
  return resolvedLaunchMode.value === 'bundled' && !!envFile.value.trim()
})

function getSidecarPayload() {
  const trimmedDualLlmApiKey = dualLlmApiKey.value.trim()
  const trimmedDualLlmBaseUrl = dualLlmBaseUrl.value.trim()
  const trimmedDualLlmModel = dualLlmModel.value.trim()
  const trimmedEnvFile = envFile.value.trim()
  const trimmedKokoroProjectDir = kokoroProjectDir.value.trim()
  const trimmedRvcModelPath = rvcModelPath.value.trim()
  const trimmedRvcIndexPath = rvcIndexPath.value.trim()

  return {
    baseUrl: baseUrl.value,
    bridgeDir: bridgeDir.value.trim(),
    ...(trimmedDualLlmApiKey ? { dualLlmApiKey: trimmedDualLlmApiKey } : {}),
    ...(trimmedDualLlmBaseUrl ? { dualLlmBaseUrl: trimmedDualLlmBaseUrl } : {}),
    ...(trimmedDualLlmModel ? { dualLlmModel: trimmedDualLlmModel } : {}),
    ...(trimmedEnvFile ? { envFile: trimmedEnvFile } : {}),
    ...(trimmedKokoroProjectDir ? { kokoroProjectDir: trimmedKokoroProjectDir } : {}),
    ...(trimmedRvcModelPath ? { rvcModelPath: trimmedRvcModelPath } : {}),
    ...(trimmedRvcIndexPath ? { rvcIndexPath: trimmedRvcIndexPath } : {}),
  }
}

async function refreshProviderResources() {
  voicesLoading.value = true

  try {
    await providersStore.fetchModelsForProvider(providerId)
    await speechStore.loadVoicesForProvider(providerId)
  }
  finally {
    voicesLoading.value = false
  }
}

async function refreshSidecarStatus() {
  sidecarStatusLoading.value = true

  try {
    const status = await getFrierenSpeechSidecarStatusOnDesktop(getSidecarPayload())
    if (!status) {
      throw new Error('Frieren RVC sidecar is only available in AIRI Desktop.')
    }

    sidecarStatus.value = status
  }
  catch (error) {
    sidecarStatus.value = {
      launchMode: bridgeDir.value.trim() ? 'external' : 'bundled',
      message: errorMessageFrom(error) ?? 'Failed to inspect the Frieren RVC sidecar runtime.',
      resolvedBridgeDir: bridgeDir.value.trim(),
      status: 'invalid',
      validatedBaseUrl: baseUrl.value,
    }
  }
  finally {
    sidecarStatusLoading.value = false
  }
}

const debouncedRefreshSidecarStatus = useDebounceFn(() => {
  void refreshSidecarStatus()
}, 400)

async function handleInstallOrRepair() {
  sidecarActionLoading.value = 'install'

  try {
    const status = await installFrierenSpeechSidecarOnDesktop(getSidecarPayload())
    if (!status) {
      throw new Error('Frieren RVC sidecar is only available in AIRI Desktop.')
    }

    sidecarStatus.value = status
  }
  finally {
    sidecarActionLoading.value = null
    await refreshSidecarStatus()
  }
}

async function handleImportFromEnvFile() {
  sidecarActionLoading.value = 'import'
  configImportMessage.value = ''

  try {
    const importedConfig = await importFrierenSpeechSidecarConfigOnDesktop(getSidecarPayload())
    if (!importedConfig) {
      throw new Error('Frieren RVC sidecar is only available in AIRI Desktop.')
    }

    configImportMessage.value = importedConfig.message
    if (!importedConfig.imported) {
      return
    }

    dualLlmApiKey.value = importedConfig.dualLlmApiKey || ''
    dualLlmBaseUrl.value = importedConfig.dualLlmBaseUrl || defaultDualLlmBaseUrl
    dualLlmModel.value = importedConfig.dualLlmModel || defaultDualLlmModel
    kokoroProjectDir.value = importedConfig.kokoroProjectDir || ''
    rvcModelPath.value = importedConfig.rvcModelPath || ''
    rvcIndexPath.value = importedConfig.rvcIndexPath || ''
  }
  finally {
    sidecarActionLoading.value = null
    await refreshSidecarStatus()
  }
}

async function handleRestartSidecar() {
  sidecarActionLoading.value = 'restart'

  try {
    const status = await restartFrierenSpeechSidecarOnDesktop(getSidecarPayload())
    if (!status) {
      throw new Error('Frieren RVC sidecar is only available in AIRI Desktop.')
    }

    sidecarStatus.value = status

    if (status.status === 'running') {
      await refreshProviderResources()
    }
  }
  finally {
    sidecarActionLoading.value = null
    await refreshSidecarStatus()
  }
}

async function handleTestDualLlm() {
  sidecarActionLoading.value = 'test-dual-llm'
  dualLlmTestResult.value = undefined

  try {
    const result = await testFrierenSpeechDualLlmOnDesktop(getSidecarPayload())
    if (!result) {
      throw new Error('Frieren RVC sidecar is only available in AIRI Desktop.')
    }

    dualLlmTestResult.value = result
  }
  finally {
    sidecarActionLoading.value = null
    await refreshSidecarStatus()
  }
}

async function handleGenerateSpeech(input: string, voiceId: string, _useSSML: boolean) {
  const provider = await providersStore.getProviderInstance<SpeechProvider<string>>(providerId)
  if (!provider) {
    throw new Error('Failed to initialize speech provider')
  }

  const providerConfig = providersStore.getProviderConfig(providerId)
  const selectedModel = (providerConfig.model as string | undefined) || defaultModel
  const selectedVoice = voiceId || (providerConfig.voice as string | undefined) || defaultVoice
  const voiceSettings = typeof providerConfig.voiceSettings === 'object' && providerConfig.voiceSettings != null
    ? providerConfig.voiceSettings as Record<string, unknown>
    : {}

  return await speechStore.speech(
    provider,
    selectedModel,
    input,
    selectedVoice,
    {
      ...providerConfig,
      speed: speed.value,
      voiceSettings: {
        ...voiceSettings,
        speed: speed.value,
      },
    },
  )
}

onMounted(async () => {
  providersStore.initializeProvider(providerId)

  const providerConfig = providersStore.getProviderConfig(providerId)
  providerConfig.baseUrl = (providerConfig.baseUrl as string | undefined) || defaultBaseUrl
  providerConfig.dualLlmBaseUrl = (providerConfig.dualLlmBaseUrl as string | undefined) || defaultDualLlmBaseUrl
  providerConfig.dualLlmModel = (providerConfig.dualLlmModel as string | undefined) || defaultDualLlmModel
  providerConfig.model = (providerConfig.model as string | undefined) || defaultModel
  providerConfig.voice = (providerConfig.voice as string | undefined) || defaultVoice
  const existingVoiceSettings = typeof providerConfig.voiceSettings === 'object' && providerConfig.voiceSettings != null
    ? providerConfig.voiceSettings as Record<string, unknown>
    : {}
  providerConfig.voiceSettings = {
    ...defaultVoiceSettings,
    ...existingVoiceSettings,
  }

  await refreshSidecarStatus()
})

watch([bridgeDir, dualLlmApiKey, dualLlmBaseUrl, dualLlmModel, envFile, kokoroProjectDir, rvcModelPath, rvcIndexPath, baseUrl], () => {
  debouncedRefreshSidecarStatus()
})

watch([isValid, bridgeDir, dualLlmApiKey, dualLlmBaseUrl, dualLlmModel, envFile, kokoroProjectDir, rvcModelPath, rvcIndexPath, baseUrl], async ([valid]) => {
  if (!valid) {
    return
  }

  await refreshProviderResources()
}, {
  immediate: true,
})
</script>

<template>
  <SpeechProviderSettings
    :provider-id="providerId"
    :default-model="defaultModel"
    :additional-settings="defaultVoiceSettings"
    :show-api-key-input="false"
    :show-base-url-input="false"
    :show-advanced-settings="false"
    :on-reset="handleResetSettings"
  >
    <template #basic-settings>
      <Alert type="info">
        <template #title>
          {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.callout.title') }}
        </template>
        <template #content>
          {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.callout.description') }}
        </template>
      </Alert>

      <Alert
        v-if="configImportMessage"
        type="info"
      >
        <template #title>
          {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.import.title') }}
        </template>
        <template #content>
          {{ configImportMessage }}
        </template>
      </Alert>

      <Alert
        v-if="dualLlmTestResult"
        :type="dualLlmTestResult.success ? 'success' : 'error'"
      >
        <template #title>
          {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.dual-llm-test.title') }}
        </template>
        <template #content>
          <div :class="['flex flex-col gap-2']">
            <p :class="['whitespace-pre-wrap break-all']">
              {{ dualLlmTestResult.message }}
            </p>
            <p :class="['text-xs text-neutral-600 dark:text-neutral-300']">
              {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.dual-llm-test.duration', { durationMs: dualLlmTestResult.durationMs }) }}
            </p>
            <p
              v-if="dualLlmTestResult.statusCode"
              :class="['text-xs text-neutral-600 dark:text-neutral-300']"
            >
              HTTP {{ dualLlmTestResult.statusCode }}
            </p>
            <div
              v-if="dualLlmTestResult.responseText"
              :class="['rounded-lg bg-black/4 px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all dark:bg-white/6']"
            >
              {{ dualLlmTestResult.responseText }}
            </div>
          </div>
        </template>
      </Alert>

      <Alert
        v-if="sidecarStatusLoading && !sidecarStatus"
        type="loading"
      >
        <template #title>
          {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.loading') }}
        </template>
      </Alert>

      <Alert
        v-else-if="sidecarStatus"
        :type="sidecarStatusAlertType"
      >
        <template #title>
          {{ sidecarStatusTitle }}
        </template>
        <template #content>
          <div :class="['flex flex-col gap-4']">
            <p :class="['whitespace-pre-wrap break-all']">
              {{ sidecarStatus.message }}
            </p>

            <div :class="['flex flex-col gap-2 text-xs text-neutral-600 dark:text-neutral-300']">
              <div
                v-for="detail in sidecarRuntimeDetails"
                :key="detail.label"
                :class="['flex flex-col gap-1 rounded-lg bg-black/4 px-3 py-2 dark:bg-white/6']"
              >
                <span :class="['font-medium']">{{ detail.label }}</span>
                <span :class="['break-all font-mono']">{{ detail.value }}</span>
              </div>
            </div>

            <div :class="['flex flex-wrap gap-2']">
              <Button
                size="sm"
                variant="secondary"
                :loading="sidecarStatusLoading"
                :disabled="sidecarActionLoading !== null"
                @click="refreshSidecarStatus"
              >
                {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.actions.refresh') }}
              </Button>

              <Button
                v-if="canImportFromEnvFile"
                size="sm"
                variant="secondary"
                :loading="sidecarActionLoading === 'import'"
                :disabled="sidecarActionLoading !== null"
                @click="handleImportFromEnvFile"
              >
                {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.actions.import-env') }}
              </Button>

              <Button
                v-if="canInstallOrRepair"
                size="sm"
                variant="secondary"
                :loading="sidecarActionLoading === 'install'"
                :disabled="sidecarActionLoading !== null"
                @click="handleInstallOrRepair"
              >
                {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.actions.install-or-repair') }}
              </Button>

              <Button
                v-if="resolvedLaunchMode === 'bundled'"
                size="sm"
                variant="secondary"
                :loading="sidecarActionLoading === 'test-dual-llm'"
                :disabled="sidecarActionLoading !== null"
                @click="handleTestDualLlm"
              >
                {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.actions.test-dual-llm') }}
              </Button>

              <Button
                size="sm"
                variant="secondary"
                :loading="sidecarActionLoading === 'restart'"
                :disabled="sidecarActionLoading !== null"
                @click="handleRestartSidecar"
              >
                {{ t('settings.pages.providers.provider.frieren-rvc-sidecar.runtime.actions.restart') }}
              </Button>
            </div>
          </div>
        </template>
      </Alert>

      <ProviderValidationAlerts
        :is-valid="isValid"
        :is-validating="isValidating"
        :validation-message="validationMessage"
        :has-manual-validators="hasManualValidators"
        :is-manual-testing="isManualTesting"
        :manual-test-passed="manualTestPassed"
        :manual-test-message="manualTestMessage"
        :on-run-test="runManualTest"
        :on-force-valid="forceValid"
        :on-go-to-model-selection="() => router.push('/settings/modules/speech')"
        :show-go-to-model-selection="false"
      />

      <FieldInput
        v-if="resolvedLaunchMode === 'bundled'"
        v-model="dualLlmApiKey"
        :label="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-api-key.label')"
        :description="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-api-key.description')"
        :placeholder="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-api-key.placeholder')"
        type="password"
      />

      <FieldInput
        v-if="resolvedLaunchMode === 'bundled'"
        v-model="dualLlmBaseUrl"
        :label="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-base-url.label')"
        :description="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-base-url.description')"
        :placeholder="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-base-url.placeholder')"
      />

      <FieldInput
        v-if="resolvedLaunchMode === 'bundled'"
        v-model="dualLlmModel"
        :label="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-model.label')"
        :description="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-model.description')"
        :placeholder="t('settings.pages.providers.provider.frieren-rvc-sidecar.fields.field.dual-llm-model.placeholder')"
      />
    </template>

    <template #voice-settings>
      <FieldRange
        v-model="speed"
        :label="t('settings.pages.providers.provider.common.fields.field.speed.label')"
        :description="t('settings.pages.providers.provider.common.fields.field.speed.description')"
        :min="0.5"
        :max="2.0"
        :step="0.01"
      />
    </template>

    <template #playground>
      <SpeechPlayground
        :available-voices="availableVoices"
        :generate-speech="handleGenerateSpeech"
        :api-key-configured="sidecarConfigured"
        :voices-loading="voicesLoading"
        :default-text="t('settings.pages.providers.provider.frieren-rvc-sidecar.playground.default-text')"
      />
    </template>
  </SpeechProviderSettings>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
