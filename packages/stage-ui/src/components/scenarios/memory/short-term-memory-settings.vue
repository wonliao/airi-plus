<script setup lang="ts">
import { FieldCheckbox, FieldInput, FieldRange, Select } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { onMounted, watch } from 'vue'

import MemoryValidationAlerts from './memory-validation-alerts.vue'

import { useShortTermMemoryStore } from '../../../stores/modules/memory-short-term'

const store = useShortTermMemoryStore()
const {
  enabled,
  backendId,
  configured,
  validationStatus,
  lastValidation,
  mode,
  userId,
  baseUrl,
  apiKey,
  extractionMode,
  extractionLlmConfigured,
  extractionLlmProvider,
  extractionLlmModel,
  extractionProviderOptions,
  extractionModelOptions,
  embedder,
  vectorStore,
  autoRecall,
  autoCapture,
  topK,
  searchThreshold,
  lastCaptureDebug,
  lastRecallDebug,
} = storeToRefs(store)

const modeOptions = [
  { label: 'Open Source', value: 'open-source', description: 'Self-managed mem0 setup' },
  { label: 'Platform', value: 'platform', description: 'Managed mem0 platform mode' },
]

watch(extractionLlmProvider, async (providerId, previousProviderId) => {
  if (!providerId.trim()) {
    extractionLlmModel.value = ''
    return
  }

  await store.ensureExtractionProviderModelsLoaded()

  if (providerId !== previousProviderId) {
    extractionLlmModel.value = extractionModelOptions.value[0]?.value ?? ''
  }
}, { immediate: true })

onMounted(async () => {
  await store.ensureExtractionProviderModelsLoaded()
})
</script>

<template>
  <div :class="['flex flex-col gap-6 pb-6']">
    <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
      <div :class="['flex flex-col gap-2']">
        <div :class="['flex items-center gap-2']">
          <h2 :class="['text-lg font-medium text-neutral-800 dark:text-neutral-100']">
            {{ $t('settings.pages.modules.memory-short-term.sections.configuration.title') }}
          </h2>
          <span :class="['rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-200']">
            {{ backendId }}
          </span>
        </div>
        <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
          {{ $t('settings.pages.modules.memory-short-term.sections.configuration.description') }}
        </p>
      </div>
    </div>

    <div :class="['grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]']">
      <div :class="['flex flex-col gap-5']">
        <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <FieldCheckbox
            v-model="enabled"
            :label="$t('settings.pages.modules.memory-short-term.fields.enabled.label')"
            :description="$t('settings.pages.modules.memory-short-term.fields.enabled.description')"
          />
        </div>

        <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <div :class="['grid grid-cols-1 gap-5 md:grid-cols-2']">
            <div :class="['flex flex-col gap-4']">
              <div :class="['text-sm font-medium']">
                {{ $t('settings.pages.modules.memory-short-term.fields.mode.label') }}
              </div>
              <Select
                v-model="mode"
                :options="modeOptions"
                :placeholder="$t('settings.pages.modules.memory-short-term.fields.mode.placeholder')"
              />
              <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                {{ $t('settings.pages.modules.memory-short-term.fields.mode.description') }}
              </div>
            </div>

            <FieldInput
              v-model="userId"
              :label="$t('settings.pages.modules.memory-short-term.fields.userId.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.userId.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.userId.placeholder')"
            />

            <FieldInput
              v-model="baseUrl"
              :label="$t('settings.pages.modules.memory-short-term.fields.baseUrl.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.baseUrl.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.baseUrl.placeholder')"
            />

            <FieldInput
              v-model="apiKey"
              type="password"
              :label="$t('settings.pages.modules.memory-short-term.fields.apiKey.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.apiKey.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.apiKey.placeholder')"
            />

            <FieldInput
              v-model="embedder"
              :label="$t('settings.pages.modules.memory-short-term.fields.embedder.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.embedder.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.embedder.placeholder')"
            />

            <FieldInput
              v-model="vectorStore"
              :label="$t('settings.pages.modules.memory-short-term.fields.vectorStore.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.vectorStore.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.vectorStore.placeholder')"
            />
          </div>
        </div>

        <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <div :class="['mb-5 flex flex-col gap-2']">
            <div :class="['flex items-center justify-between gap-3']">
              <div :class="['text-sm font-medium text-neutral-800 dark:text-neutral-100']">
                {{ $t('settings.pages.modules.memory-short-term.sections.extraction.title') }}
              </div>

              <span
                :class="[
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  extractionLlmConfigured
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
                ]"
              >
                {{ extractionMode === 'llm-assisted'
                  ? $t('settings.pages.modules.memory-short-term.fields.extractionMode.assisted')
                  : $t('settings.pages.modules.memory-short-term.fields.extractionMode.default') }}
              </span>
            </div>

            <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
              {{ $t('settings.pages.modules.memory-short-term.sections.extraction.description') }}
            </p>
          </div>

          <div :class="['grid grid-cols-1 gap-5 md:grid-cols-2']">
            <div :class="['flex flex-col gap-2']">
              <div :class="['text-sm font-medium text-neutral-800 dark:text-neutral-100']">
                {{ $t('settings.pages.modules.memory-short-term.fields.extractionLlmStatus.label') }}
              </div>
              <div
                :class="[
                  'rounded-xl border px-3 py-2 text-sm',
                  extractionLlmConfigured
                    ? 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900/40 dark:bg-primary-950/30 dark:text-primary-200'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-200',
                ]"
              >
                {{ extractionLlmConfigured
                  ? $t('settings.pages.modules.memory-short-term.fields.extractionLlmStatus.configured')
                  : $t('settings.pages.modules.memory-short-term.fields.extractionLlmStatus.notConfigured') }}
              </div>
              <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                {{ $t('settings.pages.modules.memory-short-term.fields.extractionLlmStatus.description') }}
              </div>
            </div>

            <div :class="['flex flex-col gap-4']">
              <div :class="['text-sm font-medium']">
                {{ $t('settings.pages.modules.memory-short-term.fields.extractionLlmProvider.label') }}
              </div>
              <Select
                v-model="extractionLlmProvider"
                :options="extractionProviderOptions"
                :placeholder="$t('settings.pages.modules.memory-short-term.fields.extractionLlmProvider.placeholder')"
              />
              <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                {{ $t('settings.pages.modules.memory-short-term.fields.extractionLlmProvider.description') }}
              </div>
            </div>

            <div :class="['flex flex-col gap-4']">
              <div :class="['text-sm font-medium']">
                {{ $t('settings.pages.modules.memory-short-term.fields.extractionLlmModel.label') }}
              </div>
              <Select
                v-model="extractionLlmModel"
                :options="extractionModelOptions"
                :placeholder="$t('settings.pages.modules.memory-short-term.fields.extractionLlmModel.placeholder')"
              />
              <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                {{ $t('settings.pages.modules.memory-short-term.fields.extractionLlmModel.description') }}
              </div>
            </div>
          </div>
        </div>

        <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <div :class="['grid grid-cols-1 gap-5 md:grid-cols-2']">
            <FieldCheckbox
              v-model="autoRecall"
              :label="$t('settings.pages.modules.memory-short-term.fields.autoRecall.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.autoRecall.description')"
            />

            <FieldCheckbox
              v-model="autoCapture"
              :label="$t('settings.pages.modules.memory-short-term.fields.autoCapture.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.autoCapture.description')"
            />
          </div>

          <div :class="['mt-5 grid grid-cols-1 gap-5 md:grid-cols-2']">
            <FieldRange
              v-model="topK"
              :label="$t('settings.pages.modules.memory-short-term.fields.topK.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.topK.description')"
              :min="1"
              :max="20"
              :step="1"
            />

            <FieldRange
              v-model="searchThreshold"
              :label="$t('settings.pages.modules.memory-short-term.fields.searchThreshold.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.searchThreshold.description')"
              :min="0"
              :max="1"
              :step="0.05"
            />
          </div>
        </div>
      </div>

      <div :class="['flex flex-col gap-4']">
        <MemoryValidationAlerts
          :enabled="enabled"
          :configured="configured"
          :validation-status="validationStatus"
          :validation-message="lastValidation"
          :on-validate="store.validateConfiguration"
        />

        <div :class="['rounded-2xl border p-5 text-sm', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <div :class="['font-medium text-neutral-800 dark:text-neutral-100']">
            {{ $t('settings.pages.modules.memory-short-term.notes.title') }}
          </div>
          <p :class="['mt-2 text-neutral-600 dark:text-neutral-400']">
            {{ $t('settings.pages.modules.memory-short-term.notes.content') }}
          </p>
        </div>

        <div :class="['rounded-2xl border p-5 text-sm', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <div :class="['font-medium text-neutral-800 dark:text-neutral-100']">
            {{ $t('settings.pages.modules.memory-short-term.captureTips.title') }}
          </div>
          <p :class="['mt-2 text-neutral-600 dark:text-neutral-400']">
            {{ $t('settings.pages.modules.memory-short-term.captureTips.content') }}
          </p>
          <div :class="['mt-3 flex flex-col gap-2 text-neutral-600 dark:text-neutral-400']">
            <div>{{ $t('settings.pages.modules.memory-short-term.captureTips.example1') }}</div>
            <div>{{ $t('settings.pages.modules.memory-short-term.captureTips.example2') }}</div>
            <div>{{ $t('settings.pages.modules.memory-short-term.captureTips.example3') }}</div>
          </div>
        </div>

        <div :class="['rounded-2xl border p-5 text-sm', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <div :class="['font-medium text-neutral-800 dark:text-neutral-100']">
            {{ $t('settings.pages.modules.memory-short-term.debug.title') }}
          </div>
          <p :class="['mt-2 text-neutral-600 dark:text-neutral-400']">
            {{ $t('settings.pages.modules.memory-short-term.debug.description') }}
          </p>

          <div :class="['mt-4 flex flex-col gap-4']">
            <div :class="['rounded-xl border p-4', 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40']">
              <div :class="['text-sm font-medium text-neutral-800 dark:text-neutral-100']">
                {{ $t('settings.pages.modules.memory-short-term.debug.lastCapture') }}
              </div>
              <div v-if="lastCaptureDebug" :class="['mt-3 flex flex-col gap-2 text-xs text-neutral-600 dark:text-neutral-400']">
                <div>{{ lastCaptureDebug.message }}</div>
                <div>{{ $t('settings.pages.modules.memory-short-term.debug.timestamp') }}: {{ lastCaptureDebug.at }}</div>
                <div v-if="typeof lastCaptureDebug.resultCount === 'number'">
                  {{ $t('settings.pages.modules.memory-short-term.debug.resultCount') }}: {{ lastCaptureDebug.resultCount }}
                </div>
                <div v-if="lastCaptureDebug.captureMode">
                  {{ $t('settings.pages.modules.memory-short-term.debug.captureMode') }}: {{ lastCaptureDebug.captureMode }}
                </div>
                <div v-if="lastCaptureDebug.candidates?.length" :class="['flex flex-col gap-1']">
                  <div>{{ $t('settings.pages.modules.memory-short-term.debug.candidates') }}:</div>
                  <ul :class="['list-disc pl-4']">
                    <li v-for="candidate in lastCaptureDebug.candidates" :key="candidate">
                      {{ candidate }}
                    </li>
                  </ul>
                </div>
                <div v-if="lastCaptureDebug.operations?.length" :class="['flex flex-col gap-1']">
                  <div>{{ $t('settings.pages.modules.memory-short-term.debug.operations') }}:</div>
                  <ul :class="['list-disc pl-4']">
                    <li v-for="operation in lastCaptureDebug.operations" :key="operation">
                      {{ operation }}
                    </li>
                  </ul>
                </div>
                <pre :class="['overflow-x-auto rounded-lg bg-neutral-100 p-3 whitespace-pre-wrap break-words dark:bg-neutral-900']">{{ lastCaptureDebug.payload || $t('settings.pages.modules.memory-short-term.debug.emptyPayload') }}</pre>
              </div>
              <div v-else :class="['mt-3 text-xs text-neutral-500 dark:text-neutral-400']">
                {{ $t('settings.pages.modules.memory-short-term.debug.emptyState') }}
              </div>
            </div>

            <div :class="['rounded-xl border p-4', 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40']">
              <div :class="['text-sm font-medium text-neutral-800 dark:text-neutral-100']">
                {{ $t('settings.pages.modules.memory-short-term.debug.lastRecall') }}
              </div>
              <div v-if="lastRecallDebug" :class="['mt-3 flex flex-col gap-2 text-xs text-neutral-600 dark:text-neutral-400']">
                <div>{{ lastRecallDebug.message }}</div>
                <div>{{ $t('settings.pages.modules.memory-short-term.debug.timestamp') }}: {{ lastRecallDebug.at }}</div>
                <div v-if="typeof lastRecallDebug.resultCount === 'number'">
                  {{ $t('settings.pages.modules.memory-short-term.debug.resultCount') }}: {{ lastRecallDebug.resultCount }}
                </div>
                <pre :class="['overflow-x-auto rounded-lg bg-neutral-100 p-3 whitespace-pre-wrap break-words dark:bg-neutral-900']">{{ lastRecallDebug.payload || $t('settings.pages.modules.memory-short-term.debug.emptyPayload') }}</pre>
              </div>
              <div v-else :class="['mt-3 text-xs text-neutral-500 dark:text-neutral-400']">
                {{ $t('settings.pages.modules.memory-short-term.debug.emptyState') }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
