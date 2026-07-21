"use client";

/**
 * ExtractedWordsPanel — word list with "Add All" button
 * Extracted from message-item.tsx
 */

import React, { useState, useEffect } from "react";
import { cachedFetch } from "@/lib/fetch-cache";

interface ExtractedWord {
	word: string;
	phonetic: string | null;
	translation: string | null;
	tag: string | null;
	collins: number | null;
}

export function ExtractedWordsPanel({
	words: extractedWords,
	knownCount,
	group,
	message,
}: {
	words: ExtractedWord[];
	knownCount: number;
	group: string | null;
	message: string;
}) {
	const [addingAll, setAddingAll] = useState(false);
	const [addResult, setAddResult] = useState<any>(null);
	const [selectedGroup, setSelectedGroup] = useState<string>(group ?? "日常");
	const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
	const [groupsLoaded, setGroupsLoaded] = useState(false);

	useEffect(() => {
		if (groupsLoaded) return;
		cachedFetch<{ groups: any[] }>('/api/groups')
			.then((data) => {
				setGroups(data.groups ?? []);
				setGroupsLoaded(true);
				if (!group && data.groups?.length > 0) {
					const defaultGroup = data.groups.find((g: any) => g.isDefault);
					if (defaultGroup) setSelectedGroup(defaultGroup.name);
				}
			})
			.catch(() => setGroupsLoaded(true));
	}, [groupsLoaded, group]);

	const handleAddAll = () => {
		if (addingAll) return;
		setAddingAll(true);
		const wordList = extractedWords.map((w) => w.word);
		const message = `请使用 batch-add-words 工具将以下单词添加到词库：${wordList.join(", ")}，分组为"${selectedGroup}"`;
		window.dispatchEvent(
			new CustomEvent("vocab-send-message", { detail: { message } }),
		);
		setAddResult({ success: true, message: "已发送添加请求" });
		setAddingAll(false);
	};

	return (
		<div className="mt-2 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 overflow-hidden">
			<div className="flex items-center justify-between px-3 py-2">
				<div className="flex items-center gap-2">
					<svg
						className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
						/>
					</svg>
					<span className="text-sm font-medium text-blue-700 dark:text-blue-300">
						提取了 {extractedWords.length} 个生词
					</span>
					{knownCount > 0 && (
						<span className="text-xs text-muted-foreground">
							（已认识 {knownCount} 个）
						</span>
					)}
				</div>
			</div>

			<div className="px-3 pb-2 max-h-64 overflow-y-auto space-y-1">
				{extractedWords.map((w, i) => (
					<div
						key={i}
						className="flex items-start gap-2 text-xs py-1 border-b border-blue-100 dark:border-blue-900/50 last:border-0"
					>
						<div className="flex-1 min-w-0">
							<div className="flex items-baseline gap-1.5 flex-wrap">
								<span className="font-semibold text-sm">{w.word}</span>
								{w.phonetic && (
									<span className="text-muted-foreground">{w.phonetic}</span>
								)}
								{w.collins && (
									<span className="text-amber-500 text-[10px]">
										{"★".repeat(w.collins)}
									</span>
								)}
								{w.tag && (
									<span className="text-[10px] px-1 py-0 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
										{w.tag.split(/\s+/)[0]}
									</span>
								)}
							</div>
							{w.translation && (
								<div className="text-muted-foreground mt-0.5 line-clamp-2">
									{w.translation}
								</div>
							)}
						</div>
					</div>
				))}
			</div>

			{!addResult && (
				<div className="px-3 pb-2 pt-1 space-y-2">
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground shrink-0">
							添加到分组：
						</span>
						<select
							value={selectedGroup}
							onChange={(e) => setSelectedGroup(e.target.value)}
							className="flex-1 text-xs px-2 py-1 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-blue-400"
						>
							{groups.map((g) => (
								<option key={g.id} value={g.name}>
									{g.name}
								</option>
							))}
							{!groupsLoaded && <option value="日常">日常</option>}
						</select>
					</div>
					<button
						type="button"
						onClick={handleAddAll}
						disabled={addingAll}
						className="w-full py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
					>
						{addingAll ? (
							<>
								<span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
								添加中...
							</>
						) : (
							<>
								<svg
									className="w-4 h-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={2}
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M12 4v16m8-8H4"
									/>
								</svg>
								全部添加到词库
							</>
						)}
					</button>
				</div>
			)}
			{addResult && (
				<div
					className={`px-3 pb-2 pt-1 text-xs ${addResult.success ? "text-green-600" : "text-red-500"}`}
				>
					{addResult.message}
				</div>
			)}
		</div>
	);
}
