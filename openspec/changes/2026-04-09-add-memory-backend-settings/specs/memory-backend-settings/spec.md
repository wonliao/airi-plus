## ADDED Requirements

### Requirement: AIRI exposes native memory backend settings
The system SHALL expose native AIRI settings for short-term and long-term memory backends instead of leaving memory configuration as `WIP`.

| Example | Input | Expected outcome |
|---|---|---|
| Memory overview available | User opens `Settings -> Memory` | AIRI shows a real overview page with short-term and long-term memory entries |
| Short-term settings available | User opens `Settings -> Memory -> Short-Term Memory` | AIRI shows a dedicated configuration page for short-term memory |
| Long-term settings available | User opens `Settings -> Memory -> Long-Term Memory` | AIRI shows a dedicated configuration page for long-term memory |

#### Scenario: Memory overview replaces the current WIP page
- **WHEN** the user navigates to the memory settings root
- **THEN** the system SHALL render a memory overview page instead of a generic `WIP` placeholder

#### Scenario: Short-term memory has a dedicated configuration page
- **WHEN** the user opens the short-term memory settings page
- **THEN** the system SHALL render a page dedicated to short-term memory backend configuration

#### Scenario: Long-term memory has a dedicated configuration page
- **WHEN** the user opens the long-term memory settings page
- **THEN** the system SHALL render a page dedicated to long-term memory backend configuration

### Requirement: Short-term memory is modeled as a mem0-backed module
The system SHALL model short-term memory as an AIRI memory module whose first supported backend is `mem0`.

| Example | Input | Expected outcome |
|---|---|---|
| Default short-term backend | Fresh settings state | Short-term memory starts disabled or in a safe empty state until configured |
| Mem0 configured | User enables short-term memory and configures the fixed `mem0` technology | Settings persist as short-term memory module state rather than as a chat provider |
| Required mem0 fields present | User fills the minimum mem0 fields | Short-term memory can become `configured` |

#### Scenario: Short-term memory persists as module state
- **WHEN** the user edits short-term memory settings
- **THEN** the system SHALL persist them as short-term memory module state rather than as chat provider credentials

#### Scenario: Mem0 is the first supported short-term backend
- **WHEN** the user configures short-term memory in the first release
- **THEN** the system SHALL support `mem0` as the primary short-term memory backend

#### Scenario: Short-term memory does not expose a backend selector in the first release
- **WHEN** the user configures short-term memory in the first release
- **THEN** the system SHALL present the page as mem0 configuration
- **AND** it SHALL not require the user to choose among multiple short-term memory backends first

#### Scenario: Short-term configuration includes mem0-specific fields
- **WHEN** the user configures the `mem0` backend
- **THEN** the system SHALL expose fields for the minimum mem0-related configuration, including connection or mode settings and recall or capture behavior

### Requirement: Long-term memory is modeled as an llm-wiki-backed module
The system SHALL model long-term memory as an AIRI memory module whose first supported backend is `llm-wiki`.

| Example | Input | Expected outcome |
|---|---|---|
| Default long-term backend | Fresh settings state | Long-term memory starts disabled or in a safe empty state until configured |
| llm-wiki configured | User enables long-term memory and configures the fixed `llm-wiki` technology | Settings persist as long-term memory module state rather than as an OpenClaw-owned config |
| Required llm-wiki fields present | User fills workspace and minimum query settings | Long-term memory can become `configured` |

#### Scenario: Long-term memory persists as module state
- **WHEN** the user edits long-term memory settings
- **THEN** the system SHALL persist them as long-term memory module state rather than as chat provider credentials

#### Scenario: llm-wiki is the first supported long-term backend
- **WHEN** the user configures long-term memory in the first release
- **THEN** the system SHALL support `llm-wiki` as the primary long-term memory backend

#### Scenario: Long-term memory does not expose a backend selector in the first release
- **WHEN** the user configures long-term memory in the first release
- **THEN** the system SHALL present the page as llm-wiki configuration
- **AND** it SHALL not require the user to choose among multiple long-term memory backends first

#### Scenario: Long-term configuration includes wiki-specific fields
- **WHEN** the user configures the `llm-wiki` backend
- **THEN** the system SHALL expose fields for minimum workspace, query, and review or promotion-related settings

### Requirement: Memory backend settings are decoupled from OpenClaw naming
The system SHALL model memory settings independently from OpenClaw-specific naming and ownership.

| Example | Input | Expected outcome |
|---|---|---|
| Persisted short-term state | User saves mem0 settings | Keys are stored under a memory namespace rather than `openclaw.mem0.*` |
| Persisted long-term state | User saves llm-wiki settings | Keys are stored under a memory namespace rather than `openclaw.wiki.*` |
| Future runtime integration | OpenClaw consumes AIRI memory settings later | OpenClaw acts as a consumer of memory settings instead of owning the schema |

#### Scenario: Short-term memory avoids OpenClaw-owned naming
- **WHEN** the system stores short-term memory settings
- **THEN** it SHALL use a memory-specific namespace rather than an OpenClaw-specific namespace

#### Scenario: Long-term memory avoids OpenClaw-owned naming
- **WHEN** the system stores long-term memory settings
- **THEN** it SHALL use a memory-specific namespace rather than an OpenClaw-specific namespace

#### Scenario: UI wording presents memory backends as AIRI memory settings
- **WHEN** the user reads memory settings UI copy
- **THEN** the system SHALL describe `mem0` and `llm-wiki` as memory backends or modules rather than as OpenClaw-owned subfeatures

### Requirement: Memory modules expose configured state independently
The system SHALL expose configured state for short-term and long-term memory through dedicated memory stores.

| Example | Input | Expected outcome |
|---|---|---|
| Short-term incomplete | User enables mem0 but omits required fields | Short-term memory is not configured |
| Long-term incomplete | User enables llm-wiki but omits workspace information | Long-term memory is not configured |
| Both complete | User fills minimum required fields for both pages | Both memory modules report configured=true independently |

#### Scenario: Short-term memory configured state comes from a memory store
- **WHEN** AIRI renders the modules list
- **THEN** the short-term memory module configured state SHALL come from the short-term memory store rather than a hardcoded value

#### Scenario: Long-term memory configured state comes from a memory store
- **WHEN** AIRI renders the modules list
- **THEN** the long-term memory module configured state SHALL come from the long-term memory store rather than a hardcoded value

#### Scenario: Configured is distinct from validated
- **WHEN** the user has completed the minimum required fields but has not run any health check yet
- **THEN** the system MAY mark the memory module as configured
- **AND** it SHALL still preserve validation or health-check status separately

#### Scenario: Memory stores persist validation state explicitly
- **WHEN** AIRI stores short-term or long-term memory state
- **THEN** the system SHALL preserve explicit validation state separately from the configured flag
- **AND** it SHALL keep the latest validation result or equivalent health-check output available to the settings UI

### Requirement: Memory modules integrate with existing module reset flows
The system SHALL integrate the new memory modules with AIRI's existing module reset and data maintenance flows.

| Example | Input | Expected outcome |
|---|---|---|
| Reset modules | User runs "Reset module settings" | Short-term and long-term memory settings are reset together with other module settings |
| Reset desktop state | Desktop reset path runs | Memory module state is cleared along with the rest of the module-level settings |

#### Scenario: Module reset clears memory settings
- **WHEN** the user triggers the existing module reset flow
- **THEN** the system SHALL reset short-term and long-term memory module state together with the other module stores

#### Scenario: Data maintenance stays aligned with new memory stores
- **WHEN** AIRI adds short-term and long-term memory as module stores
- **THEN** the existing data-maintenance reset path SHALL be updated so it does not leave stale memory settings behind

### Requirement: First release scope stops at settings, status, and basic health contracts
The system SHALL allow the first release of memory backend settings to ship before full runtime orchestration is implemented.

| Example | Input | Expected outcome |
|---|---|---|
| Settings-only rollout | Pages and stores are implemented, runtime adapters are partial | Feature is still valid if configured state and basic validation contracts work |
| Runtime deferred | Recall, capture, query, or promotion are not all wired yet | The settings feature remains in-scope for the first release |
| Future integration | OpenClaw or another runtime later consumes the settings | No persisted schema migration is required purely because runtime ownership changes |

#### Scenario: Full runtime automation is not required for first release
- **WHEN** the first release of memory backend settings is delivered
- **THEN** the system SHALL not require full mem0 recall or capture automation or full llm-wiki promotion automation to consider the settings feature complete

#### Scenario: Basic health-check boundaries are enough for first release
- **WHEN** the system implements initial memory backend validation
- **THEN** the system SHALL allow minimal health-check or validation contracts without requiring the final runtime integration path to be finished
