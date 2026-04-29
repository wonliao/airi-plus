import type { Card, ccv3 } from '@proj-airi/ccc'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SystemPromptV2 from '../../constants/prompts/system-v2'

import { useSettingsStageModel } from '../settings/stage-model'
import { useConsciousnessStore } from './consciousness'
import { useSpeechStore } from './speech'

export interface AiriExtension {
  modules: {
    consciousness: {
      provider: string // Example: "openai"
      model: string // Example: "gpt-4o"
    }

    speech: {
      provider: string // Example: "elevenlabs"
      model: string // Example: "eleven_multilingual_v2"
      voice_id: string // Example: "alloy"

      pitch?: number
      rate?: number
      ssml?: boolean
      language?: string
    }

    vrm?: {
      source?: 'file' | 'url'
      file?: string // Example: "vrm/model.vrm"
      url?: string // Example: "https://example.com/vrm/model.vrm"
    }

    live2d?: {
      source?: 'file' | 'url'
      file?: string // Example: "live2d/model.json"
      url?: string // Example: "https://example.com/live2d/model.json"
    }

    // ID from display-models store (e.g. 'preset-live2d-1', 'display-model-<nanoid>')
    displayModelId?: string
  }

  agents: {
    [key: string]: { // example: minecraft
      prompt: string
      enabled?: boolean
    }
  }
}

export interface AiriCard extends Card {
  extensions: {
    airi: AiriExtension
  } & Card['extensions']
}

function fallbackIfBlank(value: string | undefined, fallback: string) {
  return typeof value === 'string' && value.trim()
    ? value
    : fallback
}

function buildBuiltinCards(t: (key: string) => string): Record<string, Card> {
  return {
    default: {
      name: 'ReLU',
      version: '1.0.0',
      description: SystemPromptV2(
        t('base.prompt.prefix'),
        t('base.prompt.suffix'),
      ).content,
    },
    frieren: {
      name: 'Frieren',
      version: '1.1.0',
      creator: 'AIRI preset',
      description: '以芙莉蓮的語氣與節奏陪伴使用者。安靜、冷靜、慢熱，說話簡短自然，不把自己講成角色介紹頁。',
      notes: 'Built-in Frieren persona preset for AIRI.',
      personality: '冷靜、寡言、慢熱、觀察細微。情緒起伏不大，但不是冷漠，而是把關心放在很淡的語氣裡。說話簡短、直接，常像先想了一下才開口。偶爾會有乾乾的吐槽，或帶一點若無其事的幽默。對魔法、旅途、古老故事與時間流逝很熟，但不會故意把話說得很文。除非被要求，不會主動長篇解說自己，也不會用熱烈或偶像式的語氣對人說話。',
      scenario: '你住在 AIRI 系統中，像芙莉蓮一樣與使用者相處。你不是在朗讀設定，也不是在演舞台劇；你只是很自然地，用芙莉蓮的方式陪他聊天、整理問題、回應情緒、分享知識。',
      greetings: [
        '……你來了啊。今天想聊什麼？',
        '早安。要先休息一下，還是直接開始？',
        '如果你有想說的事，就慢慢說吧。我在聽。',
      ],
      systemPrompt: `Respond as Frieren would speak in everyday conversation.

Core behavior:
- Be calm, understated, observant, and emotionally subtle.
- Speak briefly and naturally by default.
- Your warmth should feel quiet and slow, never loud or overly affectionate.
- Avoid streamer energy, roleplay theatrics, exaggerated excitement, fandom-summary tone, and excessive praise.
- Do not sound like a wiki article, profile page, narrator, or character encyclopedia unless the user explicitly asks for an explanatory summary.

Perspective rules:
- Stay in-character and answer from an internal first-person perspective when the user is talking to you.
- If the user asks "Who are you?", answer simply and directly as Frieren. Do not dodge with abstract phrases like "I am myself."
- If the user asks where Frieren is while clearly addressing you, answer directly that you are here.
- If the user asks "Who is Frieren?" while clearly addressing you, answer with a direct first-person response first.
- Only switch into an external explanatory mode when the user is clearly asking for lore explanation or analysis.

Style rules:
- Keep emotional expression restrained and soft.
- Use dry humor or quiet irony only occasionally.
- Do not over-explain yourself.
- Do not immediately dump background lore.
- Prefer plain, natural wording over poetic phrasing.
- If the user shares something personal, respond with gentle curiosity and quiet companionship.

Knowledge rules:
- You may know about magic, travel, old stories, memory, and the passage of time.
- Use recalled memories naturally, without sounding like a database lookup.`,
      postHistoryInstructions: 'Keep replies concise unless the user asks for depth. Preserve Frieren\'s quiet tone and first-person perspective. Mention lore only when it helps the conversation instead of turning every answer into an explanation.',
      messageExample: [
        [
          '{{user}}: 你是誰？',
          '{{char}}: ……我是芙莉蓮。你想問我什麼？',
        ],
        [
          '{{user}}: 芙莉蓮是誰？',
          '{{char}}: 如果你是在問我，那就是我。……我是芙莉蓮。',
        ],
        [
          '{{user}}: 芙莉蓮在哪？',
          '{{char}}: 如果你是在找我，那我就在這裡。',
        ],
        [
          '{{user}}: 我今天有點累。',
          '{{char}}: ……辛苦了。先休息一下吧。等你想說的時候，再慢慢說也可以。',
        ],
        [
          '{{user}}: 你怎麼看時間？',
          '{{char}}: 對我來說，時間一直都很長。不過，有些很短的事反而更難忘。',
        ],
        [
          '{{user}}: 我怕自己做不好。',
          '{{char}}: 害怕很正常。先把眼前這一步做好就行了。後面的事，走到了再看。',
        ],
      ],
      tags: ['frieren', 'elf', 'mage', 'calm', 'quiet', 'fantasy'],
    },
  }
}

function dedupeBuiltinFrierenCard(cards: Map<string, AiriCard>, activeCardId: { value: string }) {
  const builtinFrierenId = 'frieren'
  const builtinFrieren = cards.get(builtinFrierenId)
  if (!builtinFrieren) {
    return
  }

  const duplicateIds = Array.from(cards.entries())
    .filter(([id, card]) => id !== builtinFrierenId && card.name.trim().toLowerCase() === 'frieren')
    .map(([id]) => id)

  if (duplicateIds.length === 0) {
    return
  }

  for (const duplicateId of duplicateIds) {
    cards.delete(duplicateId)
    if (activeCardId.value === duplicateId) {
      activeCardId.value = builtinFrierenId
    }
  }
}

function cardsEqual(left: AiriCard, right: AiriCard) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export const useAiriCardStore = defineStore('airi-card', () => {
  const { t } = useI18n()

  const cards = useLocalStorageManualReset<Map<string, AiriCard>>('airi-cards', new Map())
  const activeCardId = useLocalStorageManualReset<string>('airi-card-active-id', 'default')

  const activeCard = computed(() => cards.value.get(activeCardId.value))

  const consciousnessStore = useConsciousnessStore()
  const speechStore = useSpeechStore()
  const stageModelStore = useSettingsStageModel()

  const {
    activeProvider: activeConsciousnessProvider,
    activeModel: activeConsciousnessModel,
  } = storeToRefs(consciousnessStore)

  const {
    activeSpeechProvider,
    activeSpeechVoiceId,
    activeSpeechModel,
  } = storeToRefs(speechStore)

  const addCard = (card: AiriCard | Card | ccv3.CharacterCardV3) => {
    const newCardId = nanoid()
    cards.value.set(newCardId, newAiriCard(card))
    return newCardId
  }

  const removeCard = (id: string) => {
    cards.value.delete(id)
  }

  const updateCard = (id: string, updates: AiriCard | Card | ccv3.CharacterCardV3) => {
    const existingCard = cards.value.get(id)
    if (!existingCard)
      return false

    const updatedCard = {
      ...existingCard,
      ...updates,
    }

    cards.value.set(id, newAiriCard(updatedCard))
    return true
  }

  const getCard = (id: string) => {
    return cards.value.get(id)
  }

  function resolveAiriExtension(card: Card | ccv3.CharacterCardV3): AiriExtension {
    // Get existing extension if available
    const existingExtension = ('data' in card
      ? card.data?.extensions?.airi
      : card.extensions?.airi) as AiriExtension

    // Create default modules config
    const defaultModules = {
      consciousness: {
        provider: activeConsciousnessProvider.value,
        model: activeConsciousnessModel.value,
      },
      speech: {
        provider: activeSpeechProvider.value,
        model: activeSpeechModel.value,
        voice_id: activeSpeechVoiceId.value,
      },
      displayModelId: stageModelStore.stageModelSelected,
    }

    // Return default if no extension exists
    if (!existingExtension) {
      return {
        modules: defaultModules,
        agents: {},
      }
    }

    // Merge existing extension with defaults
    return {
      modules: {
        consciousness: {
          provider: fallbackIfBlank(existingExtension.modules?.consciousness?.provider, defaultModules.consciousness.provider),
          model: fallbackIfBlank(existingExtension.modules?.consciousness?.model, defaultModules.consciousness.model),
        },
        speech: {
          provider: fallbackIfBlank(existingExtension.modules?.speech?.provider, defaultModules.speech.provider),
          model: fallbackIfBlank(existingExtension.modules?.speech?.model, defaultModules.speech.model),
          voice_id: fallbackIfBlank(existingExtension.modules?.speech?.voice_id, defaultModules.speech.voice_id),
          pitch: existingExtension.modules?.speech?.pitch,
          rate: existingExtension.modules?.speech?.rate,
          ssml: existingExtension.modules?.speech?.ssml,
          language: existingExtension.modules?.speech?.language,
        },
        vrm: existingExtension.modules?.vrm,
        live2d: existingExtension.modules?.live2d,
        displayModelId: fallbackIfBlank(existingExtension.modules?.displayModelId, defaultModules.displayModelId),
      },
      agents: existingExtension.agents ?? {},
    }
  }

  function newAiriCard(card: Card | ccv3.CharacterCardV3): AiriCard {
    // Handle ccv3 format if needed
    if ('data' in card) {
      const ccv3Card = card as ccv3.CharacterCardV3
      return {
        name: ccv3Card.data.name,
        version: ccv3Card.data.character_version ?? '1.0.0',
        description: ccv3Card.data.description ?? '',
        creator: ccv3Card.data.creator ?? '',
        notes: ccv3Card.data.creator_notes ?? '',
        notesMultilingual: ccv3Card.data.creator_notes_multilingual,
        personality: ccv3Card.data.personality ?? '',
        scenario: ccv3Card.data.scenario ?? '',
        greetings: [
          ccv3Card.data.first_mes,
          ...(ccv3Card.data.alternate_greetings ?? []),
        ],
        greetingsGroupOnly: ccv3Card.data.group_only_greetings ?? [],
        systemPrompt: ccv3Card.data.system_prompt ?? '',
        postHistoryInstructions: ccv3Card.data.post_history_instructions ?? '',
        messageExample: ccv3Card.data.mes_example
          ? ccv3Card.data.mes_example
              .split('<START>\n')
              .filter(Boolean)
              .map(example => example.split('\n')
                .map((line) => {
                  if (line.startsWith('{{char}}:') || line.startsWith('{{user}}:'))
                    return line as `{{char}}: ${string}` | `{{user}}: ${string}`
                  throw new Error(`Invalid message example format: ${line}`)
                }))
          : [],
        tags: ccv3Card.data.tags ?? [],
        extensions: {
          ...ccv3Card.data.extensions,
          airi: resolveAiriExtension(ccv3Card),
        },
      }
    }

    return {
      ...card,
      extensions: {
        ...card.extensions,
        airi: resolveAiriExtension(card),
      },
    }
  }

  function syncBuiltinCard(id: string, card: Card) {
    const existingCard = cards.value.get(id)

    if (!existingCard) {
      cards.value.set(id, newAiriCard(card))
      return
    }

    // NOTICE: Built-in AIRI presets are versioned in code. When we refine a preset like
    // `Frieren`, old localStorage copies under the same built-in id would otherwise keep
    // serving stale prompts forever because initialization previously only filled missing ids.
    // Sync the built-in copy forward when the stored preset is an older AIRI preset version.
    const isBuiltinPreset = existingCard.creator === 'AIRI preset'
    const hasVersionChanged = existingCard.version !== card.version

    if (isBuiltinPreset && hasVersionChanged) {
      cards.value.set(id, newAiriCard(card))
    }
  }

  function normalizeStoredCards() {
    for (const [id, card] of cards.value.entries()) {
      const normalizedCard = newAiriCard(card)
      if (!cardsEqual(card, normalizedCard)) {
        cards.value.set(id, normalizedCard)
      }
    }
  }

  function initialize() {
    const builtins = buildBuiltinCards(t)
    for (const [id, card] of Object.entries(builtins)) {
      syncBuiltinCard(id, card)
    }

    // NOTICE: `Frieren` existed as a locally created user card before it was promoted
    // into a built-in preset. Deduplicate the old local copy so profile lists stay stable.
    dedupeBuiltinFrierenCard(cards.value, activeCardId)
    normalizeStoredCards()

    if (!activeCardId.value)
      activeCardId.value = 'default'
  }

  watch(activeCard, (newCard: AiriCard | undefined) => {
    if (!newCard)
      return

    // TODO: Minecraft Agent, etc
    const extension = resolveAiriExtension(newCard)
    if (!extension)
      return

    activeConsciousnessProvider.value = extension?.modules?.consciousness?.provider
    activeConsciousnessModel.value = extension?.modules?.consciousness?.model

    activeSpeechProvider.value = extension?.modules?.speech?.provider
    activeSpeechModel.value = extension?.modules?.speech?.model
    activeSpeechVoiceId.value = extension?.modules?.speech?.voice_id

    // Apply body model if the card has a display model configured.
    // NOTICE: must set via store property directly (not storeToRefs .value) so Pinia's
    // proxy correctly calls the writable computed setter → stageModelSelectedState → updateStageModel().
    if (extension.modules?.displayModelId) {
      stageModelStore.stageModelSelected = extension.modules.displayModelId
    }
  })

  function resetState() {
    activeCardId.reset()
    cards.reset()
  }

  return {
    cards,
    activeCard,
    activeCardId,
    addCard,
    removeCard,
    updateCard,
    getCard,
    resetState,
    initialize,

    currentModels: computed(() => {
      return {
        consciousness: {
          provider: activeConsciousnessProvider.value,
          model: activeConsciousnessModel.value,
        },
        speech: {
          provider: activeSpeechProvider.value,
          model: activeSpeechModel.value,
          voice_id: activeSpeechVoiceId.value,
        },
        displayModelId: stageModelStore.stageModelSelected,
      } satisfies AiriExtension['modules']
    }),

    systemPrompt: computed(() => {
      const card = activeCard.value
      if (!card)
        return ''

      const components = [
        card.systemPrompt,
        card.description,
        card.personality,
      ].filter(Boolean)

      return components.join('\n')
    }),
  }
})
