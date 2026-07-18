# Progress

## Session: 2025-01

### Phase 1: globalThis → AsyncLocalStorage ✅

- Created `src/lib/pi/mode-context.ts` with AsyncLocalStorage
- Updated `src/app/api/chat/route.ts` to use `runWithModeContext()`
- Updated `.pi-vocab/extensions/vocab-agent.ts` to import from `mode-context`
- Removed `globalThis` hack and `getCurrentModeContext` export from route.ts
- Fixed empty catch block → proper error logging

### Phase 2: Pi Session 并发防护 ✅

- Confirmed Pi SDK `Agent.prompt()` throws on concurrent calls
- Added `queuePrompt()` with serialization queue in `src/lib/pi/session.ts`
- Updated `route.ts` to use `queuePrompt()` instead of `session.prompt()`
- Added `abortAndClearQueue()` for client disconnect handling
- Queue depth limit: 5 (returns clear error when full)

### Phase 3: 动态命令沙盒 timeout ✅

- Added 10s timeout to `executeDynamicCommand()` in `src/lib/commands/executor.ts`
- Uses `Promise.race([execution, timeout])`
- Timeout returns `command-error` type with descriptive message

### Phase 4: 工具 schema 去重 ✅ (务实方案)

- Created `src/lib/ai/tools/schema-sync.ts` — validates Zod→JSON Schema
- Created `.pi-vocab/tools/wrap-tool.ts` — shared execute adapter
- Attempted Zod→TypeBox auto-conversion but hit typebox v1.3.6 type incompatibility
- Reverted tool files to original Zod approach
- Schema sync script can be run to detect mismatches

### Phase 5: vocab-agent.ts 拆分 ✅

- Created `wrapTool()` adapter in `.pi-vocab/tools/wrap-tool.ts` (115行)
- Extracted Teacher tools → `.pi-vocab/tools/teacher-tools.ts` (314行, 12 tools)
- Extracted Developer tools → `.pi-vocab/tools/developer-tools.ts` (236行, 9 tools)
- vocab-agent.ts reduced from 841行 → 129行 (only routing logic)
- Fixed `result` → `r` reference error in developer-tools.ts
- Fixed `safe-ls` missing `details: null` in execute return

### Phase 6: message-item.tsx 拆分 ✅

- Created `src/components/tool-renderers/` directory with 12 files:
  - `registry.tsx` (446行) — pluggable renderer registry + all built-in renderers
  - `text-bubbles.tsx` (124行) — AssistantTextBubble + UserTextBubble
  - `dev-tool-output.tsx` (95行) — collapsed developer tool display
  - `batch-added-words.tsx` (125行) — carousel of added words
  - `compact-word-card.tsx` (48行) — shared word card for carousels
  - `extracted-words-panel.tsx` (183行) — word list with "Add All" button
  - `batch-add-result.tsx` (153行) — batch-add-words result carousel
  - `agent-status.tsx` (175行) — phase indicator (reasoning/calling-tool/done/error)
  - `token-usage-badge.tsx` (51行) — debug panel token display
  - `pin-change-notifier.tsx` (15行) — fires notifyPinChange on mount
  - `merge-parts.ts` (135行) — MergedPart types + mergeReasoningParts
  - `utils.ts` (148行) — TOOL_DISPLAY_NAMES, DEV_TOOL_LABELS, formatTime, etc.
- message-item.tsx reduced from 1817行 → 236行 (-87%)

### Phase 7: chat-panel.tsx 拆分 ✅

- Created `src/components/chat/hooks/` directory with 3 hooks:
  - `use-due-count.ts` (81行) — due word count polling + notification events
  - `use-chat-history.ts` (110行) — message loading, pagination, persistence
  - `use-command-interceptor.ts` (173行) — / command execution + submit handler
- chat-panel.tsx reduced from 518行 → 240行 (-54%)
- Fixed activeGroup passing (was null, now correctly from useGroup)
- Fixed initialHasMore parameter passing to useChatHistory

### Phase 8: API 统一中间件 ✅

- Created `src/lib/api/handler.ts` (102行) — apiHandlerV2 + ApiError + parseBody
- Applied to 5 routes: commands, review-due, health, command-list, debug-logs
- Route reorganization skipped — changing URLs would break frontend, low ROI

### Phase 9: 次要优化 ✅

- Developer prompt already within ≤280 line target (262行)
- component-registry empty-load already has graceful fallback
- Fixed activeGroup passing in chat-panel body function
- SSE reconnection deferred — single-user app, resend works
- ToolResult union type deferred — large type definition effort, low ROI

### TypeScript: 0 errors ✅

### Unit Tests: 43/43 passed ✅

## Summary of All Changes

### New Files (20)

| File | Lines | Purpose |
| ------ | ------- | --------- |
| `src/lib/pi/mode-context.ts` | ~30 | AsyncLocalStorage for request-scoped mode |
| `src/lib/ai/tools/schema-sync.ts` | ~80 | Zod→JSON Schema validation script |
| `src/lib/api/handler.ts` | 102 | API route error handling utilities |
| `.pi-vocab/tools/wrap-tool.ts` | 115 | Shared tool registration adapter |
| `.pi-vocab/tools/teacher-tools.ts` | 314 | 12 Teacher tools via wrapTool() |
| `.pi-vocab/tools/developer-tools.ts` | 236 | 9 Developer tools via wrapTool() |
| `src/components/tool-renderers/registry.tsx` | 446 | Pluggable tool output renderer |
| `src/components/tool-renderers/text-bubbles.tsx` | 124 | Assistant/User text bubbles |
| `src/components/tool-renderers/dev-tool-output.tsx` | 95 | Collapsed dev tool display |
| `src/components/tool-renderers/batch-added-words.tsx` | 125 | Added words carousel |
| `src/components/tool-renderers/compact-word-card.tsx` | 48 | Shared compact word card |
| `src/components/tool-renderers/extracted-words-panel.tsx` | 183 | Word list + Add All |
| `src/components/tool-renderers/batch-add-result.tsx` | 153 | Batch add result carousel |
| `src/components/tool-renderers/agent-status.tsx` | 175 | Agent phase indicator |
| `src/components/tool-renderers/token-usage-badge.tsx` | 51 | Debug token display |
| `src/components/tool-renderers/pin-change-notifier.tsx` | 15 | Pin change event trigger |
| `src/components/tool-renderers/merge-parts.ts` | 135 | MergedPart types + merge logic |
| `src/components/tool-renderers/utils.ts` | 148 | Shared constants + utilities |
| `src/components/chat/hooks/use-due-count.ts` | 81 | Due count polling hook |
| `src/components/chat/hooks/use-chat-history.ts` | 110 | Message persistence hook |
| `src/components/chat/hooks/use-command-interceptor.ts` | 173 | Command execution hook |

### Modified Files (8)

| File | Before → After | Change |
| ------ | ---------------- | -------- |
| `.pi-vocab/extensions/vocab-agent.ts` | 841 → 129行 | -85% routing only |
| `src/components/chat/message-item.tsx` | 1817 → 236行 | -87% uses registry |
| `src/components/chat/chat-panel.tsx` | 518 → 240行 | -54% uses hooks |
| `src/app/api/chat/route.ts` | ~200行 | AsyncLocalStorage + queuePrompt |
| `src/lib/pi/session.ts` | ~80行 | +queuePrompt +abortAndClearQueue |
| `src/lib/commands/executor.ts` | ~200行 | +10s timeout on dynamic commands |
| `src/app/api/commands/route.ts` | 25 → 15行 | apiHandlerV2 |
| `src/app/api/review-due/route.ts` | 18 → 19行 | apiHandlerV2 |

### Deleted Temp Files

- `scripts/convert-tools-to-typebox.js`
- `scripts/fix-typebox-schemas.js`
- `scripts/fix-typebox-closing.js`
- `scripts/fix-parens.js`
- `src/lib/ai/tools/string-enum.ts`
