"use client";

/**
 * Tool Output Renderer Registry
 *
 * Replaces the monolithic renderToolOutput() function in message-item.tsx
 * with a pluggable registry. Each output.type gets its own renderer component.
 *
 * Usage:
 *   import { renderToolOutput } from "@/components/tool-renderers/registry";
 *   return renderToolOutput(key, toolName, output);
 */

import React from "react";
import { WordCard } from "@/components/vocab/word-card";
import { PronounceButton } from "@/components/vocab/pronounce-button";
import { DynamicRenderer } from "@/components/generative/dynamic-renderer";
import { componentRegistry } from "@/components/generative/component-registry";
import { PinButton } from "@/components/pinned/pin-button";
import { AssistantTextBubble } from "./text-bubbles";
import { DevToolOutput } from "./dev-tool-output";
import { BatchAddResult } from "./batch-add-result";
import { ExtractedWordsPanel } from "./extracted-words-panel";
import { PinChangeNotifier } from "./pin-change-notifier";
import { DEV_TOOL_NAMES, SUPPRESSED_TOOL_NAMES } from "./utils";

// ── Types ────────────────────────────────────────────────────────────────

export interface ToolOutputProps {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	output: any;
	toolName: string;
}

export type ToolRenderer = React.ComponentType<ToolOutputProps>;

// ── Registry ─────────────────────────────────────────────────────────────

const registry = new Map<string, ToolRenderer>();

export function registerToolRenderer(type: string, renderer: ToolRenderer) {
	registry.set(type, renderer);
}

export function getToolRenderer(type: string): ToolRenderer | undefined {
	return registry.get(type);
}

export function hasToolRenderer(type: string): boolean {
	return registry.has(type);
}

// ── Generative component registry integration ────────────────────────────

// ── Render function (replaces the old renderToolOutput) ──────────────────

/**
 * Render tool output. Returns null for suppressed tools (readSeek_*, pi builtins).
 * Checks: 1) suppressed tools → null, 2) dev tools → DevToolOutput,
 * 3) type registry → registered renderer, 4) dynamic component registry,
 * 5) JSON fallback.
 */
export function renderToolOutput(
	key: number,
	toolName: string,
	output: any,
): React.ReactNode {
	// Suppressed tools — return null (agent synthesizes info in text)
	if (SUPPRESSED_TOOL_NAMES.has(toolName)) return null;

	// Developer tools — collapsed compact display
	if (DEV_TOOL_NAMES.has(toolName)) {
		return <DevToolOutput key={key} toolName={toolName} output={output} />;
	}

	// Check specific type renderers
	const Renderer = registry.get(output.type);
	if (Renderer) {
		return <Renderer key={key} output={output} toolName={toolName} />;
	}

	// Check dynamic component registry
	const componentName = componentRegistry.has(output.type)
		? output.type
		: componentRegistry.has(toolName)
			? toolName
			: null;
	if (componentName) {
		return (
			<div key={key} className="mt-2">
				<DynamicRenderer componentName={componentName} props={output} />
			</div>
		);
	}

	// Fallback
	return (
		<div key={key} className="mt-2 text-xs text-muted-foreground">
			[{toolName}] {JSON.stringify(output).slice(0, 200)}
		</div>
	);
}

// ── Register all built-in renderers ──────────────────────────────────────

// Simple message renderers
const simpleRenderers: Record<string, (o: any) => React.ReactNode> = {
	"review-result": (o) => (
		<div className="mt-2 text-xs text-muted-foreground">
			评分: {o.rating} | 下次复习: {o.scheduledDays} 天后
		</div>
	),
	"already-exists": (o) => (
		<div className="mt-2 text-xs text-yellow-600">{o.message}</div>
	),
	"not-found": (o) => (
		<div className="mt-2 px-4 py-2.5 rounded-2xl border border-border bg-muted/50 text-sm text-muted-foreground inline-flex items-center gap-2">
			<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
			{o.message}
		</div>
	),
	"no-due-words": (o) => (
		<div className="mt-2 px-4 py-2.5 rounded-2xl border border-border bg-muted/50 text-sm text-muted-foreground">
			{o.message}
		</div>
	),
	"all-known": (o) => (
		<div className="mt-2 px-4 py-2.5 rounded-2xl border border-border bg-muted/50 text-sm text-green-600">
			{o.message}
		</div>
	),
	"no-words": (o) => (
		<div className="mt-2 px-4 py-2.5 rounded-2xl border border-border bg-muted/50 text-sm text-muted-foreground">
			{o.message}
		</div>
	),
	"already-pinned": (o) => (
		<div className="mt-2 px-4 py-2.5 rounded-2xl border border-border bg-muted/50 text-xs text-muted-foreground">
			{o.message}
		</div>
	),
	"pin-full": (o) => (
		<div className="mt-2 px-4 py-2.5 rounded-2xl border border-border bg-muted/50 text-xs text-yellow-600">
			{o.message}
		</div>
	),
	full: (o) => <div className="mt-2 px-4 py-2.5 rounded-2xl border border-border bg-muted/50 text-xs text-yellow-600">{o.message}</div>,
	message: (o) => (
		<div className="mt-2">
			<AssistantTextBubble text={o.message} />
		</div>
	),
};

for (const [type, renderFn] of Object.entries(simpleRenderers)) {
	registerToolRenderer(type, ({ output }) => <>{renderFn(output)}</>);
}

// Word card renderers
registerToolRenderer("added", ({ output: o }) => (
	<div className="mt-2 space-y-2 max-w-lg w-full">
		<div className="text-xs text-green-600">{o.message}</div>
		<WordCard
			wordId={o.wordId}
			word={o.word}
			phonetic={o.phonetic}
			audioUrl={o.audioUrl}
			definition={o.definition}
			examples={
				o.examples
					? typeof o.examples === "string"
						? o.examples
						: JSON.stringify(o.examples)
					: null
			}
			groups={o.group ? [o.group] : undefined}
			topRightSlot={<PinButton wordId={o.wordId} word={o.word} />}
		/>
	</div>
));

// Lookup results are intentionally NOT rendered as cards in chat.
// The LLM receives the tool result and synthesizes a richer text response.
registerToolRenderer("found", () => null);
registerToolRenderer("dict-found", () => null);

// Stale review session (not the latest) — collapsed summary
registerToolRenderer("due-words", ({ output: o }) => (
	<div className="mt-2 px-4 py-3 rounded-2xl border border-border bg-muted/50">
		<div className="text-xs text-muted-foreground mb-1.5">
			复习（{o.words.length} 个单词）— 已过期
		</div>
		<div className="space-y-0.5">
			{o.words.map((w: any, wi: number) => (
				<div
					key={wi}
					className="text-xs text-muted-foreground/70 flex items-center gap-1.5"
				>
					<span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
					<span className="font-medium">{w.word}</span>
					{w.phonetic && <span>{w.phonetic}</span>}
				</div>
			))}
		</div>
	</div>
));

// Dictionary lookup result (not in user's library) — render as a compact card
registerToolRenderer("dict-found", ({ output: o }) => (
	<div className="mt-2 rounded-2xl border border-border bg-muted/50 px-4 py-3 space-y-2 max-w-md">
		<div className="flex items-baseline gap-2 flex-wrap">
			<span className="text-base font-bold">{o.word}</span>
			{o.phonetic && (
				<span className="text-sm text-muted-foreground">{o.phonetic}</span>
			)}
			<PronounceButton word={o.word} audioUrl={o.audioUrl} size="md" />
			{o.collins && (
				<span className="text-xs text-amber-500">{"★".repeat(o.collins)}</span>
			)}
		</div>
		{o.translation && (
			<div className="text-sm text-foreground">
				{o.translation
					.split("\n")
					.filter(Boolean)
					.map((line: string, idx: number) => (
						<div key={idx}>{line}</div>
					))}
			</div>
		)}
		{o.definitions?.length > 0 && (
			<div className="space-y-1.5">
				{o.definitions.map((group: any, gi: number) => (
					<div key={gi}>
						{group.partOfSpeech && (
							<span className="text-xs font-medium text-muted-foreground mr-1">
								{group.partOfSpeech}
							</span>
						)}
						{group.definitions?.slice(0, 3).map((d: any, di: number) => (
							<div key={di} className="text-sm">
								<span className="text-muted-foreground">{di + 1}. </span>
								{d.definition}
								{d.example && (
									<div className="text-xs text-muted-foreground italic ml-3 mt-0.5">
										— {d.example}
									</div>
								)}
							</div>
						))}
					</div>
				))}
			</div>
		)}
		{(o.synonyms?.length > 0 || o.antonyms?.length > 0) && (
			<div className="text-xs space-y-0.5">
				{o.synonyms?.length > 0 && (
					<div>
						<span className="text-muted-foreground">同义: </span>
						{o.synonyms.slice(0, 8).join(", ")}
					</div>
				)}
				{o.antonyms?.length > 0 && (
					<div>
						<span className="text-muted-foreground">反义: </span>
						{o.antonyms.slice(0, 8).join(", ")}
					</div>
				)}
			</div>
		)}
		{o.hint && (
			<div className="text-xs text-muted-foreground italic border-t border-border pt-2">
				{o.hint}
			</div>
		)}
		{(o.bnc || o.frq) && (
			<div className="text-[10px] text-muted-foreground">
				词频: BNC #{o.bnc ?? "-"} / 当代 #{o.frq ?? "-"}
			</div>
		)}
	</div>
));

// Extracted words from text
registerToolRenderer("extracted-words", ({ output: o }) => (
	<ExtractedWordsPanel
		words={o.words}
		knownCount={o.knownCount}
		group={o.group}
		message={o.message}
	/>
));

// Batch add result
registerToolRenderer("batch-added", ({ output: o }) => (
	<BatchAddResult output={o} />
));

// Pinned word
registerToolRenderer("pinned", ({ output: o }) => (
	<div className="mt-2 space-y-2 max-w-lg w-full">
		<div className="text-xs text-primary flex items-center gap-1.5">
			<PinChangeNotifier />
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="currentColor"
				stroke="none"
			>
				<path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
			</svg>
			{o.message}
		</div>
		{o.wordId && o.definition && (
			<WordCard
				wordId={o.wordId}
				word={o.word}
				phonetic={o.phonetic || null}
				audioUrl={o.audioUrl ?? null}
				definition={o.definition}
				examples={null}
				topRightSlot={<PinButton wordId={o.wordId} word={o.word} />}
			/>
		)}
	</div>
));

// Unpinned word
registerToolRenderer("unpinned", ({ output: o }) => (
	<div className="mt-2 text-xs text-muted-foreground">
		<PinChangeNotifier />
		{o.message}
	</div>
));

// Stats result
registerToolRenderer("stats", ({ output: o }) => (
	<div className="mt-2 px-4 py-3 rounded-2xl border border-border bg-muted/50 space-y-2">
		<div className="text-sm font-medium flex items-center gap-1.5">
			<svg
				className="size-3.5 text-muted-foreground"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={2}
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"
				/>
			</svg>
			学习统计{o.group ? ` — ${o.group}` : ""}
		</div>
		<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-xs">
			<div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col">
				<div className="text-muted-foreground text-[10px] sm:text-xs mb-1">
					总词汇量
				</div>
				<div className="text-xl sm:text-2xl font-bold text-foreground">
					{o.totalWords}
				</div>
			</div>
			<div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col">
				<div className="text-muted-foreground text-[10px] sm:text-xs mb-1">
					今日复习
				</div>
				<div className="text-xl sm:text-2xl font-bold text-foreground">
					{o.daily?.reviewed ?? 0}
				</div>
			</div>
			<div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col">
				<div className="text-muted-foreground text-[10px] sm:text-xs mb-1">
					今日正确率
				</div>
				<div className="text-xl sm:text-2xl font-bold text-foreground">
					{o.daily?.correctRate ?? 0}%
				</div>
			</div>
			<div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col">
				<div className="text-muted-foreground text-[10px] sm:text-xs mb-1">
					学习中
				</div>
				<div className="text-xl sm:text-2xl font-bold text-foreground">
					{o.distribution?.learning ?? 0}
				</div>
			</div>
		</div>
		{o.groupDistribution && o.groupDistribution.length > 0 && (
			<div className="space-y-1">
				<div className="text-xs text-muted-foreground">分组分布</div>
				<div className="flex flex-wrap gap-1.5">
					{o.groupDistribution.map((g: any) => (
						<span
							key={g.id}
							className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
						>
							{g.name} ({g.wordCount})
						</span>
					))}
				</div>
			</div>
		)}
	</div>
));

// Group list
registerToolRenderer("group-list", ({ output: o }) => (
	<div className="mt-2 space-y-1.5">
		<div className="text-sm font-medium">分组列表</div>
		{o.groups?.map((g: any) => (
			<div key={g.id} className="text-xs flex items-center gap-2">
				<span className="font-medium">{g.name}</span>
				{g.isDefault && (
					<span className="text-[10px] text-muted-foreground">(默认)</span>
				)}
				<span className="text-muted-foreground">{g.wordCount} 词</span>
			</div>
		))}
	</div>
));

// Group success messages
const groupSuccessTypes = [
	"group-created",
	"group-deleted",
	"group-renamed",
	"group-switched",
	"word-added-to-group",
	"word-removed-from-group",
	"already-member",
];
for (const type of groupSuccessTypes) {
	registerToolRenderer(type, ({ output: o }) => (
		<div className="mt-2 text-xs text-green-600">{o.message}</div>
	));
}
