<script setup lang="ts">
import type { MemoryValidationStatus } from '../../../stores/modules/memory-shared'

import { computed } from 'vue'

import { Alert } from '../../misc'

type SummaryTone = 'success' | 'warning' | 'error' | 'muted'

const props = defineProps<{
  enabled: boolean
  configured: boolean
  validationStatus: MemoryValidationStatus
  validationMessage: string
  onValidate: () => Promise<unknown> | unknown
}>()

const statusType = computed(() => {
  if (props.validationStatus === 'success') {
    return 'success'
  }

  if (props.validationStatus === 'error') {
    return 'error'
  }

  return 'info'
})

const summaryItems = computed<Array<{ label: string, value: string, tone: SummaryTone }>>(() => [
  {
    label: 'settings.pages.memory.status.enabled',
    value: props.enabled
      ? 'settings.pages.memory.status.enabledValue'
      : 'settings.pages.memory.status.disabledValue',
    tone: props.enabled ? 'success' : 'muted',
  },
  {
    label: 'settings.pages.memory.status.configured',
    value: props.configured
      ? 'settings.pages.memory.status.configuredValue'
      : 'settings.pages.memory.status.incompleteValue',
    tone: props.configured ? 'success' : 'warning',
  },
  {
    label: 'settings.pages.memory.status.validated',
    value: props.validationStatus === 'success'
      ? 'settings.pages.memory.status.validatedValue'
      : props.validationStatus === 'error'
        ? 'settings.pages.memory.status.failedValue'
        : 'settings.pages.memory.status.pendingValue',
    tone: props.validationStatus === 'success'
      ? 'success'
      : props.validationStatus === 'error'
        ? 'error'
        : 'muted',
  },
])

function toneClasses(tone: SummaryTone) {
  return {
    success: ['bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'],
    warning: ['bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'],
    error: ['bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'],
    muted: ['bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'],
  }[tone]
}
</script>

<template>
  <Alert :type="statusType">
    <template #title>
      <div :class="['w-full flex items-center justify-between gap-3']">
        <span>
          {{
            validationStatus === 'success'
              ? $t('settings.pages.memory.validation.successTitle')
              : validationStatus === 'error'
                ? $t('settings.pages.memory.validation.errorTitle')
                : $t('settings.pages.memory.validation.idleTitle')
          }}
        </span>
        <button
          type="button"
          :class="[
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            'bg-primary-100 text-primary-700 hover:bg-primary-200',
            'dark:bg-primary-900/30 dark:text-primary-200 dark:hover:bg-primary-900/50',
          ]"
          @click="props.onValidate"
        >
          {{ $t('settings.pages.memory.validation.runCheck') }}
        </button>
      </div>
    </template>

    <template #content>
      <div :class="['flex flex-col gap-4 whitespace-pre-wrap break-words']">
        <div :class="['grid grid-cols-1 gap-2 sm:grid-cols-3']">
          <div
            v-for="item in summaryItems"
            :key="item.label"
            :class="['rounded-xl border p-3', 'border-neutral-200/80 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950/40']"
          >
            <div :class="['text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400']">
              {{ $t(item.label) }}
            </div>
            <div :class="['mt-2 inline-flex rounded-full px-2 py-1 text-xs font-medium', ...toneClasses(item.tone)]">
              {{ $t(item.value) }}
            </div>
          </div>
        </div>

        <span>
          {{
            validationMessage
              || (configured
                ? $t('settings.pages.memory.validation.configuredPending')
                : $t('settings.pages.memory.validation.notConfigured'))
          }}
        </span>
        <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{
            configured
              ? $t('settings.pages.memory.validation.configuredLabel')
              : $t('settings.pages.memory.validation.notConfiguredLabel')
          }}
        </span>
      </div>
    </template>
  </Alert>
</template>
