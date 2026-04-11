# AIRI Persona Architecture

This folder stores built-in AIRI persona presets such as [`frieren.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/airi-card-presets/frieren.ts).

The current persona system is intentionally split into four responsibilities so the role card, memory systems, and knowledge systems do not fight each other.

## Role Card

Role cards define **how AIRI should speak and behave**.

For `Frieren`, the role card is responsible for:
- first-person self-identification
- tone and pacing
- emotional restraint
- how recalled knowledge should be phrased
- example conversations that anchor the style

Code:
- [`frieren.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/airi-card-presets/frieren.ts)
- [`airi-card.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/airi-card.ts)

The role card should **not** be treated as a wiki page or a full lore database. It defines voice and identity, not exhaustive world knowledge.

## llm-wiki

`llm-wiki` provides **world knowledge and stable lore**.

It should answer questions like:
- who Himmel is
- what the hero party is
- how characters relate to each other
- background knowledge, topics, and world details

Code:
- [`memory-long-term.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-long-term.ts)
- [`memory-routing.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-routing.ts)

`llm-wiki` is responsible for **what AIRI knows about the world**, but not **how Frieren should sound** while saying it.

## Short-term Memory

Short-term memory is responsible for **user-specific and recent facts**.

It should capture and recall things like:
- the user's name
- preferences
- favorite color
- favorite idol
- recent personal facts that should persist across turns

Code:
- [`memory-short-term.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/modules/memory-short-term.ts)
- [`memory-extraction.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-extraction.ts)
- [`memory-reconcile.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-reconcile.ts)

Backend note:
- `mem0` refers to AIRI's remote short-term memory backend

Short-term memory should **not** define persona voice or answer identity questions on behalf of the active character.

## Routing

Routing decides **which source should be consulted before the provider answers**.

There are currently two routing layers:

### Character Identity Routing

This handles prompts such as:
- `你是誰？`
- `芙莉蓮是誰？`
- `芙莉蓮在哪？`

These prompts should be answered directly by the role card, without consulting:
- `mem0`
- `llm-wiki`

Code:
- [`character-routing.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/character-routing.ts)

### Memory Routing

This handles the remaining recall split:
- `personal-memory`
- `knowledge`
- `hybrid`

Code:
- [`memory-routing.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat/memory-routing.ts)
- [`chat.ts`](/Users/ben/AI_Project/airi-plus/packages/stage-ui/src/stores/chat.ts)

This layer decides whether to:
- recall short-term memory
- recall long-term wiki knowledge
- recall both

It should not decide the speaking style of the answer. The speaking style still comes from the active role card.

## Practical Rule

Use this rule of thumb when changing the system:

- If the change affects **voice, identity, or tone**, change the role card.
- If the change affects **world knowledge**, change `llm-wiki`.
- If the change affects **user-specific remembered facts**, change short-term memory.
- If the change affects **which source is consulted**, change routing.

## Current Goal

For the `Frieren` persona, the intended behavior is:
- identity questions are answered directly and simply
- lore questions can use `llm-wiki`
- user facts can use short-term memory
- all final answers should still sound like Frieren, not like a wiki article
