<script setup lang="ts">
import { MemoryOverview } from '@proj-airi/stage-ui/components'
import { useLongTermMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory-long-term'
import { useShortTermMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory-short-term'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const shortTermStore = useShortTermMemoryStore()
const longTermStore = useLongTermMemoryStore()
const { configured: shortTermConfigured, enabled: shortTermEnabled, validationStatus: shortTermValidationStatus } = storeToRefs(shortTermStore)
const { configured: longTermConfigured, enabled: longTermEnabled, validationStatus: longTermValidationStatus } = storeToRefs(longTermStore)

const cards = computed(() => [
  {
    id: 'short-term',
    title: t('settings.pages.modules.memory-short-term.title'),
    description: t('settings.pages.modules.memory-short-term.description'),
    configured: shortTermConfigured.value,
    enabled: shortTermEnabled.value,
    validationStatus: shortTermValidationStatus.value,
    to: '/settings/modules/memory-short-term',
  },
  {
    id: 'long-term',
    title: t('settings.pages.modules.memory-long-term.title'),
    description: t('settings.pages.modules.memory-long-term.description'),
    configured: longTermConfigured.value,
    enabled: longTermEnabled.value,
    validationStatus: longTermValidationStatus.value,
    to: '/settings/modules/memory-long-term',
  },
])
</script>

<template>
  <MemoryOverview :cards="cards" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:leaf-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
