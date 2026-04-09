<script setup lang="ts">
import type { MemoryValidationStatus } from '../../../stores/modules/memory-shared'

import { RouterLink } from 'vue-router'

const props = defineProps<{
  cards: Array<{
    id: string
    title: string
    description: string
    configured: boolean
    enabled: boolean
    validationStatus: MemoryValidationStatus
    to: string
  }>
}>()

function badgeClass(status: MemoryValidationStatus, configured: boolean) {
  if (status === 'success') {
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
  }

  if (status === 'error') {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200'
  }

  if (configured) {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
  }

  return 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
}

function summaryToneClass(tone: 'success' | 'warning' | 'error' | 'muted') {
  return {
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200',
    muted: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  }[tone]
}
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-6']">
    <div :class="['rounded-2xl p-5', 'bg-neutral-50 dark:bg-neutral-900/60', 'border border-neutral-200 dark:border-neutral-800']">
      <h2 :class="['text-lg font-medium text-neutral-800 dark:text-neutral-100']">
        {{ $t('settings.pages.memory.overview.title') }}
      </h2>
      <p :class="['mt-2 text-sm text-neutral-600 dark:text-neutral-400']">
        {{ $t('settings.pages.memory.overview.description') }}
      </p>
    </div>

    <div :class="['grid grid-cols-1 gap-4 lg:grid-cols-2']">
      <RouterLink
        v-for="card in props.cards"
        :key="card.id"
        :to="card.to"
        :class="[
          'group rounded-2xl border p-5 transition-colors',
          'border-neutral-200 bg-white hover:border-primary-300 hover:bg-primary-50/40',
          'dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-primary-500/40 dark:hover:bg-neutral-900',
        ]"
      >
        <div :class="['flex items-start justify-between gap-4']">
          <div :class="['flex flex-col gap-2']">
            <div :class="['text-lg font-medium text-neutral-800 dark:text-neutral-100']">
              {{ card.title }}
            </div>
            <div :class="['text-sm text-neutral-600 dark:text-neutral-400']">
              {{ card.description }}
            </div>
          </div>

          <div :class="['rounded-full px-2.5 py-1 text-xs font-medium', badgeClass(card.validationStatus, card.configured)]">
            {{
              card.validationStatus === 'success'
                ? $t('settings.pages.memory.status.validated')
                : card.validationStatus === 'error'
                  ? $t('settings.pages.memory.status.needsAttention')
                  : card.configured
                    ? $t('settings.pages.memory.status.configured')
                    : $t('settings.pages.memory.status.notConfigured')
            }}
          </div>
        </div>

        <div :class="['mt-4 flex items-center justify-between text-sm']">
          <div :class="['grid grid-cols-3 gap-2']">
            <div :class="['inline-flex rounded-full px-2 py-1 text-xs font-medium', summaryToneClass(card.enabled ? 'success' : 'muted')]">
              {{
                card.enabled
                  ? $t('settings.pages.memory.status.enabledValue')
                  : $t('settings.pages.memory.status.disabledValue')
              }}
            </div>
            <div :class="['inline-flex rounded-full px-2 py-1 text-xs font-medium', summaryToneClass(card.configured ? 'success' : 'warning')]">
              {{
                card.configured
                  ? $t('settings.pages.memory.status.configuredValue')
                  : $t('settings.pages.memory.status.incompleteValue')
              }}
            </div>
            <div
              :class="[
                'inline-flex rounded-full px-2 py-1 text-xs font-medium',
                summaryToneClass(
                  card.validationStatus === 'success'
                    ? 'success'
                    : card.validationStatus === 'error'
                      ? 'error'
                      : 'muted',
                ),
              ]"
            >
              {{
                card.validationStatus === 'success'
                  ? $t('settings.pages.memory.status.validatedValue')
                  : card.validationStatus === 'error'
                    ? $t('settings.pages.memory.status.failedValue')
                    : $t('settings.pages.memory.status.pendingValue')
              }}
            </div>
          </div>
          <span :class="['text-neutral-500 group-hover:text-primary-600 dark:text-neutral-400 dark:group-hover:text-primary-300']">
            {{ $t('settings.pages.memory.overview.openSettings') }}
          </span>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
