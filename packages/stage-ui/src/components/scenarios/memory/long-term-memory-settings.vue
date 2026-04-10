<script setup lang="ts">
import { FieldCheckbox, FieldInput, FieldTextArea, Select } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { onMounted } from 'vue'

import MemoryValidationAlerts from './memory-validation-alerts.vue'

import { useLongTermMemoryStore } from '../../../stores/modules/memory-long-term'

const store = useLongTermMemoryStore()
const {
  enabled,
  backendId,
  configured,
  validationStatus,
  lastValidation,
  workspacePath,
  indexPath,
  overviewPath,
  queryMode,
  allowPromotion,
  manualReviewRequired,
  personaReviewRequired,
  notes,
} = storeToRefs(store)

const queryModeOptions = [
  { label: 'Digest', value: 'digest', description: 'Summarize relevant wiki context' },
  { label: 'Direct Query', value: 'query', description: 'Read targeted pages directly' },
  { label: 'Hybrid', value: 'hybrid', description: 'Combine direct query with digest' },
]

onMounted(() => {
  void store.ensureDefaultWorkspace()
})
</script>

<template>
  <div :class="['flex flex-col gap-6 pb-6']">
    <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
      <div :class="['flex flex-col gap-2']">
        <div :class="['flex items-center gap-2']">
          <h2 :class="['text-lg font-medium text-neutral-800 dark:text-neutral-100']">
            {{ $t('settings.pages.modules.memory-long-term.sections.configuration.title') }}
          </h2>
          <span :class="['rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-200']">
            {{ backendId }}
          </span>
        </div>
        <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
          {{ $t('settings.pages.modules.memory-long-term.sections.configuration.description') }}
        </p>
      </div>
    </div>

    <div :class="['grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]']">
      <div :class="['flex flex-col gap-5']">
        <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <FieldCheckbox
            v-model="enabled"
            :label="$t('settings.pages.modules.memory-long-term.fields.enabled.label')"
            :description="$t('settings.pages.modules.memory-long-term.fields.enabled.description')"
          />
        </div>

        <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <div :class="['grid grid-cols-1 gap-5 md:grid-cols-2']">
            <FieldInput
              v-model="workspacePath"
              :label="$t('settings.pages.modules.memory-long-term.fields.workspacePath.label')"
              :description="$t('settings.pages.modules.memory-long-term.fields.workspacePath.description')"
              :placeholder="$t('settings.pages.modules.memory-long-term.fields.workspacePath.placeholder')"
            />

            <FieldInput
              v-model="indexPath"
              :label="$t('settings.pages.modules.memory-long-term.fields.indexPath.label')"
              :description="$t('settings.pages.modules.memory-long-term.fields.indexPath.description')"
              :placeholder="$t('settings.pages.modules.memory-long-term.fields.indexPath.placeholder')"
            />

            <FieldInput
              v-model="overviewPath"
              :label="$t('settings.pages.modules.memory-long-term.fields.overviewPath.label')"
              :description="$t('settings.pages.modules.memory-long-term.fields.overviewPath.description')"
              :placeholder="$t('settings.pages.modules.memory-long-term.fields.overviewPath.placeholder')"
            />

            <div :class="['flex flex-col gap-4']">
              <div :class="['text-sm font-medium']">
                {{ $t('settings.pages.modules.memory-long-term.fields.queryMode.label') }}
              </div>
              <Select
                v-model="queryMode"
                :options="queryModeOptions"
                :placeholder="$t('settings.pages.modules.memory-long-term.fields.queryMode.placeholder')"
              />
              <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                {{ $t('settings.pages.modules.memory-long-term.fields.queryMode.description') }}
              </div>
            </div>
          </div>
        </div>

        <div :class="['rounded-2xl border p-5', 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/50']">
          <div :class="['grid grid-cols-1 gap-5 md:grid-cols-2']">
            <FieldCheckbox
              v-model="allowPromotion"
              :label="$t('settings.pages.modules.memory-long-term.fields.allowPromotion.label')"
              :description="$t('settings.pages.modules.memory-long-term.fields.allowPromotion.description')"
            />

            <FieldCheckbox
              v-model="manualReviewRequired"
              :label="$t('settings.pages.modules.memory-long-term.fields.manualReviewRequired.label')"
              :description="$t('settings.pages.modules.memory-long-term.fields.manualReviewRequired.description')"
            />

            <FieldCheckbox
              v-model="personaReviewRequired"
              :label="$t('settings.pages.modules.memory-long-term.fields.personaReviewRequired.label')"
              :description="$t('settings.pages.modules.memory-long-term.fields.personaReviewRequired.description')"
            />
          </div>

          <div :class="['mt-5']">
            <FieldTextArea
              v-model="notes"
              :label="$t('settings.pages.modules.memory-long-term.fields.notes.label')"
              :description="$t('settings.pages.modules.memory-long-term.fields.notes.description')"
              :placeholder="$t('settings.pages.modules.memory-long-term.fields.notes.placeholder')"
              :rows="5"
              :required="false"
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
            {{ $t('settings.pages.modules.memory-long-term.notes.title') }}
          </div>
          <p :class="['mt-2 text-neutral-600 dark:text-neutral-400']">
            {{ $t('settings.pages.modules.memory-long-term.notes.content') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
