<script setup lang="ts">
import { DoubleCheckButton, FieldCheckbox, FieldInput, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import MemoryValidationAlerts from './memory-validation-alerts.vue'

import { useShortTermMemoryStore } from '../../../stores/modules/memory-short-term'

const store = useShortTermMemoryStore()
const { t } = useI18n()
const clearStatusMessage = ref('')

const {
  apiKey,
  appId,
  agentId,
  autoCapture,
  autoRecall,
  backendId,
  baseUrl,
  configured,
  deploymentMode,
  enabled,
  isManagedLocal,
  isClearing,
  lastCaptureDebug,
  lastRecallDebug,
  lastValidation,
  openAIApiKey,
  runId,
  searchThreshold,
  topK,
  userId,
  validationStatus,
} = storeToRefs(store)

const useManagedLocalService = computed({
  get: () => deploymentMode.value === 'electron-managed-local',
  set: value => deploymentMode.value = value ? 'electron-managed-local' : 'remote',
})

async function clearRemoteShortTermMemory() {
  clearStatusMessage.value = ''

  try {
    await store.clearShortTermMemory()
    clearStatusMessage.value = t('settings.pages.modules.memory-short-term.actions.clear.success')
  }
  catch (error) {
    clearStatusMessage.value = error instanceof Error ? error.message : String(error)
  }
}
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
          <div :class="['mb-5 flex flex-col gap-2']">
            <div :class="['text-sm font-medium text-neutral-800 dark:text-neutral-100']">
              {{ $t('settings.pages.modules.memory-short-term.sections.remote.title') }}
            </div>
            <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
              {{ $t('settings.pages.modules.memory-short-term.sections.remote.description') }}
            </p>
          </div>

          <FieldCheckbox
            v-model="useManagedLocalService"
            :label="$t('settings.pages.modules.memory-short-term.fields.useManagedLocal.label')"
            :description="$t('settings.pages.modules.memory-short-term.fields.useManagedLocal.description')"
          />

          <div :class="['grid grid-cols-1 gap-5 md:grid-cols-2']">
            <template v-if="isManagedLocal">
              <FieldInput
                v-model="openAIApiKey"
                type="password"
                :label="$t('settings.pages.modules.memory-short-term.fields.openAIApiKey.label')"
                :description="$t('settings.pages.modules.memory-short-term.fields.openAIApiKey.description')"
                :placeholder="$t('settings.pages.modules.memory-short-term.fields.openAIApiKey.placeholder')"
              />

              <div :class="['rounded-xl border p-4 text-sm', 'border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-400']">
                <div :class="['font-medium text-neutral-800 dark:text-neutral-100']">
                  {{ $t('settings.pages.modules.memory-short-term.fields.managedBaseUrl.label') }}
                </div>
                <p :class="['mt-1']">
                  {{ $t('settings.pages.modules.memory-short-term.fields.managedBaseUrl.description') }}
                </p>
                <div :class="['mt-2 font-mono text-xs']">
                  {{ store.activeBaseUrl }}
                </div>
              </div>
            </template>

            <template v-else>
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
            </template>

            <FieldInput
              v-model="userId"
              :label="$t('settings.pages.modules.memory-short-term.fields.userId.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.userId.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.userId.placeholder')"
            />

            <FieldInput
              v-model="agentId"
              :label="$t('settings.pages.modules.memory-short-term.fields.agentId.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.agentId.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.agentId.placeholder')"
            />

            <FieldInput
              v-model="runId"
              :label="$t('settings.pages.modules.memory-short-term.fields.runId.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.runId.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.runId.placeholder')"
            />

            <FieldInput
              v-model="appId"
              :label="$t('settings.pages.modules.memory-short-term.fields.appId.label')"
              :description="$t('settings.pages.modules.memory-short-term.fields.appId.description')"
              :placeholder="$t('settings.pages.modules.memory-short-term.fields.appId.placeholder')"
            />
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
          <div :class="['grid grid-cols-1 items-start gap-3']">
            <div :class="['flex flex-col gap-2']">
              <div :class="['font-medium text-neutral-800 dark:text-neutral-100']">
                {{ $t('settings.pages.modules.memory-short-term.actions.clear.title') }}
              </div>
              <p :class="['text-neutral-600 dark:text-neutral-400']">
                {{ $t('settings.pages.modules.memory-short-term.actions.clear.description') }}
              </p>
              <p
                v-if="clearStatusMessage"
                :class="['text-xs', 'text-neutral-500 dark:text-neutral-400']"
              >
                {{ clearStatusMessage }}
              </p>
            </div>

            <div :class="['flex flex-col items-start gap-2']">
              <DoubleCheckButton
                variant="danger"
                :disabled="!configured || isClearing"
                @confirm="clearRemoteShortTermMemory"
              >
                {{ isClearing
                  ? $t('settings.pages.modules.memory-short-term.actions.clear.clearing')
                  : $t('settings.pages.modules.memory-short-term.actions.clear.button') }}
                <template #confirm>
                  {{ $t('settings.pages.data.confirmations.yes') }}
                </template>
                <template #cancel>
                  {{ $t('settings.pages.card.cancel') }}
                </template>
              </DoubleCheckButton>
            </div>
          </div>
        </div>

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
