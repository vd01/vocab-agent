"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────

interface MdxSense {
	pos: string;
	grammar?: string;
	register?: string;
	geo?: string;
	senses: {
		number?: string;
		cf?: string;
		en: string;
		cn: string;
		examples?: string[];
		synonym?: string;
	}[];
	idioms?: {
		phrase: string;
		en: string;
		cn: string;
	}[];
	phrasalVerbs?: {
		phrase: string;
		senses: { en: string; cn: string; examples?: string[] }[];
	}[];
	derivedForms?: {
		word: string;
		pos?: string;
	}[];
}

interface LookupResult {
	type: string;
	word: string;
	inLibrary: boolean;
	wordId: string | null;
	groups: string[];
	isPinned: boolean;
	fsrsState: number | null;
	fsrsStateLabel: string | null;
	fsrsDue: string | null;
	phonetic: string | null;
	audioUrl: string | null;
	translation: string | null;
	definitions: {
		partOfSpeech: string;
		definitions: { definition: string; example?: string }[];
	}[];
	collins: number | null;
	tag: string | null;
	bnc: number | null;
	exchange: string | null;
	synonyms: string[];
	actions: string[];
	allGroups: { id: string; name: string }[];
	// Enriched fields
	mdxEntries?: { dict: string; html: string; text: string }[];
	mdxSenses?: MdxSense[];
	synsets?: { pos: string; definition: string; lemmas: string[]; examples: string[] }[];
	etymology?: string | null;
	source?: string | null;
}

interface ActionResult {
	type: string;
	message: string;
	[key: string]: unknown;
}

// ── English Detection ──────────────────────────────────────────────

function isEnglishWordOrPhrase(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > 100) return false;
	return /^[a-zA-Z]+(?:[-\s][a-zA-Z]+){0,5}$/.test(trimmed);
}

// ── FSRS State Labels ─────────────────────────────────────────────

const FSRS_STATE_LABELS: Record<number, { label: string; color: string }> = {
	0: { label: "新词", color: "text-blue-400" },
	1: { label: "学习中", color: "text-yellow-400" },
	2: { label: "复习中", color: "text-green-400" },
	3: { label: "重学中", color: "text-red-400" },
};

// ── Exam tag display ───────────────────────────────────────────────

const EXAM_TAG_MAP: Record<string, string> = {
	gk: "高考",
	cet4: "四级",
	cet6: "六级",
	ky: "考研",
	toefl: "托福",
	ielts: "雅思",
	gre: "GRE",
	sat: "SAT",
};

function formatExamTags(tag: string | null): { short: string; full: string }[] {
	if (!tag) return [];
	return tag
		.split(/\s+/)
		.filter(Boolean)
		.map(t => ({ short: EXAM_TAG_MAP[t] || t.toUpperCase(), full: t }));
}

// ── Exchange (inflected forms) parser ──────────────────────────────

function parseExchange(exchange: string | null): string[] {
	if (!exchange) return [];
	const forms: string[] = [];
	for (const part of exchange.split("/")) {
		const [type, form] = part.split(":");
		if (form && type) {
			// d=过去式, p=过去分词, i=现在分词, 3=第三人称单数, s=名词复数, r=比较级, t=最高级
			if (["d", "p", "i", "3", "s", "r", "t"].includes(type)) {
				forms.push(form);
			}
		}
	}
	return [...new Set(forms)];
}

// ── Tauri helpers ──────────────────────────────────────────────────

function getTauriInvoke():
	| ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
	| null {
	try {
		// @ts-expect-error Tauri internal API
		return window.__TAURI_INTERNALS__.invoke ?? null;
	} catch {
		return null;
	}
}

// ── Main Component ─────────────────────────────────────────────────

export default function QuickLookupPage() {
	const [input, setInput] = useState("");
	const [result, setResult] = useState<LookupResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [showGroupSelector, setShowGroupSelector] = useState(false);
	const [newGroupName, setNewGroupName] = useState("");
	const [expandedMdx, setExpandedMdx] = useState(false);
	const [expandedPv, setExpandedPv] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const lookupAbortRef = useRef<AbortController | null>(null);
	const lastLookupWordRef = useRef<string>("");

	const [shortcutHint, setShortcutHint] = useState("");

	// Reset expand states on new lookup
	const resetExpandStates = useCallback(() => {
		setExpandedMdx(false);
		setExpandedPv(false);
	}, []);

	// Read clipboard on window focus
	useEffect(() => {
		const handleFocus = () => { readClipboardAndLookup(); };
		window.addEventListener("focus", handleFocus);
		return () => window.removeEventListener("focus", handleFocus);
	}, []);

	// Auto-focus input on mount + load shortcut hint
	useEffect(() => {
		inputRef.current?.focus();
		loadShortcutHint();
	}, []);

	async function loadShortcutHint() {
		const invoke = getTauriInvoke();
		if (!invoke) return;
		try {
			const cfg = (await invoke("config-get")) as { quick_lookup_shortcut?: string };
			if (cfg?.quick_lookup_shortcut) setShortcutHint(cfg.quick_lookup_shortcut);
		} catch { /* config unavailable */ }
	}

	// ESC to hide window
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				const invoke = getTauriInvoke();
				if (invoke) invoke("plugin:window|hide");
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	async function readClipboardAndLookup() {
		const invoke = getTauriInvoke();
		if (!invoke) return;
		try {
			const clipboardText = await invoke("read-clipboard");
			if (typeof clipboardText === "string" && isEnglishWordOrPhrase(clipboardText)) {
				const word = clipboardText.trim();
				if (word.toLowerCase() === lastLookupWordRef.current.toLowerCase() && !loading) return;
				setInput(word);
				doLookup(word);
			}
		} catch { /* clipboard access denied */ }
	}

	async function getBaseUrl(): Promise<string> {
		const invoke = getTauriInvoke();
		if (!invoke) return "";
		try {
			const cfg = (await invoke("config-get")) as { server_url?: string };
			return cfg?.server_url?.replace(/\/+$/, "") ?? "";
		} catch { return ""; }
	}

	const doLookup = useCallback(async (word: string) => {
		const trimmed = word.trim();
		if (!trimmed) return;

		lookupAbortRef.current?.abort();
		const controller = new AbortController();
		lookupAbortRef.current = controller;
		lastLookupWordRef.current = trimmed;

		setLoading(true);
		setResult(null);
		setActionMessage(null);
		setShowGroupSelector(false);
		resetExpandStates();

		try {
			const baseUrl = await getBaseUrl();
			const base = baseUrl ? `${baseUrl}/api/quick-lookup` : "/api/quick-lookup";

			// Phase 1: fast ECDICT-only result
			const fastRes = await fetch(`${base}?word=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
			const fastData = await fastRes.json();
			if (lookupAbortRef.current !== controller) return;
			setResult(fastData);
			setLoading(false);

			// Phase 2: enriched result
			try {
				const enrichRes = await fetch(`${base}-enrich?word=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
				const enrichData = await enrichRes.json();
				if (lookupAbortRef.current === controller) {
					setResult(prev => prev ? { ...prev, ...enrichData } : prev);
				}
			} catch { /* enrichment failed silently */ }
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") return;
			if (lookupAbortRef.current === controller) {
				setResult({
					type: "error", word: trimmed, inLibrary: false, wordId: null, groups: [],
					isPinned: false, fsrsState: null, fsrsStateLabel: null, fsrsDue: null,
					phonetic: null, audioUrl: null, translation: "查询失败，请检查网络连接",
					definitions: [], collins: null, tag: null, bnc: null, exchange: null,
					synonyms: [], actions: [], allGroups: [],
				});
				setLoading(false);
			}
		}
	}, [resetExpandStates]);

	const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); doLookup(input); };

	const doAction = async (action: string, extra?: Record<string, string>) => {
		setActionLoading(action);
		setActionMessage(null);
		try {
			const baseUrl = await getBaseUrl();
			const url = baseUrl ? `${baseUrl}/api/quick-lookup-action` : "/api/quick-lookup-action";
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action, word: input.trim(), ...extra }),
			});
			const data: ActionResult = await res.json();
			setActionMessage(data.message || "操作完成");
			if (["added", "added-and-pinned", "pinned", "added-to-group"].includes(data.type)) {
				setTimeout(() => doLookup(input.trim()), 300);
			}
		} catch { setActionMessage("操作失败，请检查网络连接"); }
		finally { setActionLoading(null); }
	};

	const playAudio = (url: string | null) => {
		if (!url) return;
		new Audio(url).play().catch(() => {});
	};

	const hasActions = result && !loading && result.actions.length > 0;
	const examTags = formatExamTags(result?.tag ?? null);
	const inflectedForms = parseExchange(result?.exchange ?? null);
	const hasMdxSenses = result?.mdxSenses && result.mdxSenses.length > 0;

	// ── Render ───────────────────────────────────────────────────────

	return (
		<div className="h-screen w-screen bg-background flex flex-col overflow-hidden select-none">
			{/* Search Input */}
			<form onSubmit={handleSubmit} className="flex-shrink-0 p-3 pb-2">
				<div className="relative">
					<svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
						<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="输入单词或短语..."
						className="w-full pl-10 pr-4 py-2.5 bg-muted/50 border border-border rounded-xl
							text-foreground text-sm placeholder:text-muted-foreground
							focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
						spellCheck={false}
						autoComplete="off"
					/>
				</div>
			</form>

			{/* Result Area */}
			<div className="flex-1 overflow-y-auto px-3 pb-2">
				{loading && (
					<div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
						<svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
							<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
							<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
						</svg>
						查询中...
					</div>
				)}

				{result && !loading && (
					<div className="space-y-3">
						{/* ── Word Header ── */}
						<div>
							<div className="flex items-center gap-2">
								<span className="text-xl font-bold text-foreground">{result.word}</span>
								{result.audioUrl && (
									<button onClick={() => playAudio(result.audioUrl)} className="p-1 rounded-md hover:bg-muted transition-colors" title="播放发音">
										<svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
											<path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
										</svg>
									</button>
								)}
								{result.phonetic && (
									<span className="text-sm text-muted-foreground font-mono">{result.phonetic}</span>
								)}
							</div>
							{/* Status Badges */}
							<div className="flex flex-wrap items-center gap-1.5 mt-1.5">
								{result.inLibrary ? (
									<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-500/15 text-green-400 border border-green-500/20">✓ 已入库</span>
								) : (
									<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">未入库</span>
								)}
								{result.fsrsState !== null && FSRS_STATE_LABELS[result.fsrsState] && (
									<span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-muted ${FSRS_STATE_LABELS[result.fsrsState].color}`}>
										{FSRS_STATE_LABELS[result.fsrsState].label}
									</span>
								)}
								{result.isPinned && (
									<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-primary/15 text-primary border border-primary/20">📌 置顶</span>
								)}
								{result.groups.length > 0 && (
									<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
										{result.groups.join(", ")}
									</span>
								)}
							</div>
							{/* Exam Tags + Frequency */}
							{(examTags.length > 0 || result.collins || result.bnc) && (
								<div className="flex flex-wrap items-center gap-1.5 mt-1.5">
									{examTags.map(t => (
										<span key={t.full} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-500/15 text-blue-400 border border-blue-500/20" title={t.full}>
											{t.short}
										</span>
									))}
									{result.collins && (
										<span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
											{"★".repeat(Math.min(result.collins, 5))}
										</span>
									)}
									{result.bnc && result.bnc < 10000 && (
										<span className="text-[10px] text-muted-foreground">BNC #{result.bnc}</span>
									)}
								</div>
							)}
						</div>

						{/* ── Chinese Translation ── */}
						{result.translation && (
							<div className="text-sm text-foreground/90 leading-relaxed bg-muted/30 rounded-lg px-3 py-2 border border-border/50">
								{result.translation}
							</div>
						)}

						{/* ── MDX Senses (OALD9 structured) ── */}
						{hasMdxSenses && (
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<span className="text-[11px] font-semibold text-primary tracking-wide">📖 OALD9</span>
									{result.mdxSenses!.reduce((acc, g) => acc + g.senses.length, 0) > 3 && (
										<button
											className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
											onClick={() => setExpandedMdx(!expandedMdx)}
										>
											{expandedMdx ? "收起" : `展开全部 (${result.mdxSenses!.reduce((a, g) => a + g.senses.length, 0)}条)`}
										</button>
									)}
								</div>
								{result.mdxSenses!.map((group, gi) => {
									const visibleSenses = expandedMdx ? group.senses : group.senses.slice(0, 3);
									const hiddenCount = group.senses.length - visibleSenses.length;
									return (
										<div key={gi} className="space-y-1.5">
											{/* POS header */}
											<div className="flex items-center gap-1.5">
												<span className="text-xs font-semibold text-foreground/80">{group.pos}</span>
												{group.grammar && (
													<span className="text-[10px] text-muted-foreground">{group.grammar}</span>
												)}
												{group.register && (
													<span className="text-[10px] text-orange-400/80 italic">({group.register})</span>
												)}
											</div>
											{/* Senses */}
											{visibleSenses.map((sense, si) => (
												<div key={si} className="pl-2 border-l-2 border-border/50 space-y-0.5">
													<div className="text-xs text-foreground/85 leading-relaxed">
														{sense.cf && <span className="text-primary/70 font-medium mr-1">{sense.cf}</span>}
														{sense.en}
													</div>
													{sense.cn && (
														<div className="text-xs text-foreground/50">{sense.cn}</div>
													)}
													{sense.examples && sense.examples.length > 0 && expandedMdx && (
														<div className="text-[11px] text-muted-foreground/70 italic pl-2">
															{sense.examples[0]}
														</div>
													)}
												</div>
											))}
											{!expandedMdx && hiddenCount > 0 && (
												<div className="pl-2 text-[10px] text-muted-foreground">
													还有 {hiddenCount} 条释义...
												</div>
											)}
										</div>
									);
								})}
								{/* Idioms */}
								{result.mdxSenses!.some(g => g.idioms && g.idioms.length > 0) && (
									<div className="space-y-1">
										{result.mdxSenses!.filter(g => g.idioms).flatMap(g => g.idioms!).slice(0, expandedMdx ? 10 : 3).map((idm, i) => (
											<div key={i} className="pl-2 border-l-2 border-primary/20">
												<span className="text-xs font-medium text-foreground/80">{idm.phrase.replace(/[ˈˌ]/g, "")}</span>
												<span className="text-xs text-foreground/50 ml-1.5">— {idm.cn || idm.en}</span>
											</div>
										))}
									</div>
								)}
								{/* Phrasal Verbs */}
								{result.mdxSenses!.some(g => g.phrasalVerbs && g.phrasalVerbs.length > 0) && (() => {
									const allPvs = result.mdxSenses!.filter(g => g.phrasalVerbs).flatMap(g => g.phrasalVerbs!);
									const visiblePvs = expandedPv ? allPvs : allPvs.slice(0, 3);
									return (
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<span className="text-[11px] text-muted-foreground font-medium">短语动词</span>
												{allPvs.length > 3 && (
													<button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setExpandedPv(!expandedPv)}>
														{expandedPv ? "收起" : `+${allPvs.length - 3}`}
													</button>
												)}
											</div>
											{visiblePvs.map((pv, i) => (
												<div key={i} className="pl-2 border-l-2 border-border/50">
													<span className="text-xs font-medium text-foreground/80">{pv.phrase.replace(/[ˈˌ]/g, "")}</span>
													<span className="text-xs text-foreground/50 ml-1.5">— {pv.senses[0]?.cn || pv.senses[0]?.en.slice(0, 50)}</span>
												</div>
											))}
										</div>
									);
								})()}
							</div>
						)}

						{/* ── English Definitions (FreeDict, fallback when no MDX) ── */}
						{!hasMdxSenses && result.definitions && result.definitions.length > 0 && (
							<div className="space-y-1.5">
								{result.definitions.slice(0, 3).map((group, i) => (
									<div key={i}>
										{group.partOfSpeech && (
											<span className="text-[11px] font-semibold text-foreground/60 mr-1">{group.partOfSpeech}</span>
										)}
										<div className="space-y-0.5">
											{group.definitions.slice(0, 3).map((d, j) => (
												<div key={j} className="text-xs text-foreground/80 leading-relaxed pl-2 border-l-2 border-border/50">
													<span className="text-muted-foreground mr-1">{j + 1}.</span>
													{d.definition}
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						)}

						{/* ── Inflected Forms ── */}
						{inflectedForms.length > 0 && (
							<div className="flex flex-wrap items-center gap-1">
								<span className="text-[10px] text-muted-foreground">变形:</span>
								{inflectedForms.slice(0, 5).map(f => (
									<span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">{f}</span>
								))}
							</div>
						)}

						{/* ── Synonyms (from WordNet / FreeDict) ── */}
						{result.synonyms && result.synonyms.length > 0 && (
							<div className="flex flex-wrap items-center gap-1">
								<span className="text-[10px] text-muted-foreground">同义:</span>
								{result.synonyms.slice(0, 8).map(s => (
									<span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
										onClick={() => { setInput(s); doLookup(s); }}>
										{s}
									</span>
								))}
							</div>
						)}

						{/* ── Derived Forms (from MDX) ── */}
						{hasMdxSenses && result.mdxSenses!.some(g => g.derivedForms && g.derivedForms.length > 0) && (
							<div className="flex flex-wrap items-center gap-1">
								<span className="text-[10px] text-muted-foreground">派生:</span>
								{result.mdxSenses!.filter(g => g.derivedForms).flatMap(g => g.derivedForms!).map(df => (
									<span key={df.word} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
										onClick={() => { setInput(df.word); doLookup(df.word); }}>
										{df.word}{df.pos ? ` (${df.pos})` : ""}
									</span>
								))}
							</div>
						)}

						{/* ── Source indicator ── */}
						{result.source && (
							<div className="text-[9px] text-muted-foreground/40">{result.source}</div>
						)}

						{/* ── Action Message ── */}
						{actionMessage && (
							<div className="text-xs px-2 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20">
								{actionMessage}
							</div>
						)}
					</div>
				)}

				{/* Empty State */}
				{!result && !loading && (
					<div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-xs">
						<svg className="w-8 h-8 mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
						</svg>
						输入单词后按回车查询
						{shortcutHint ? `${shortcutHint} 快速打开` : "设置快捷键快速打开"}
					</div>
				)}
			</div>

			{/* Action Bar */}
			{hasActions && (
				<div className="flex-shrink-0 border-t border-border bg-background/95 backdrop-blur-sm px-3 py-2 space-y-2">
					{showGroupSelector && result && (
						<div className="space-y-1.5 border border-border rounded-lg p-2">
							<div className="text-xs text-muted-foreground">选择分组：</div>
							<div className="flex flex-wrap gap-1">
								{result.allGroups.map(g => (
									<button key={g.id} className="px-2 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors disabled:opacity-50"
										onClick={() => { doAction("add-to-group", { groupId: g.id }); setShowGroupSelector(false); }}
										disabled={actionLoading !== null}>
										{g.name}
									</button>
								))}
							</div>
							<div className="flex items-center gap-1.5 mt-1">
								<input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
									placeholder="新建分组名..."
									className="flex-1 px-2 py-1 text-xs bg-muted/50 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
									onKeyDown={(e) => { if (e.key === "Enter" && newGroupName.trim()) { doAction("add-to-group", { groupName: newGroupName.trim() }); setShowGroupSelector(false); setNewGroupName(""); } }}
								/>
								<button className="px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
									disabled={!newGroupName.trim() || actionLoading !== null}
									onClick={() => { if (newGroupName.trim()) { doAction("add-to-group", { groupName: newGroupName.trim() }); setShowGroupSelector(false); setNewGroupName(""); } }}>
									创建
								</button>
							</div>
						</div>
					)}
					<div className="flex flex-wrap gap-1.5">
						{result!.actions.includes("add-to-library") && (
							<ActionButton label="入库" icon="📚" loading={actionLoading === "add-to-library"} onClick={() => doAction("add-to-library")} />
						)}
						{result!.actions.includes("add-and-pin") && (
							<ActionButton label="入库并置顶" icon="📌" loading={actionLoading === "add-and-pin"} onClick={() => doAction("add-and-pin")} />
						)}
						{result!.actions.includes("pin") && (
							<ActionButton label="置顶" icon="📌" loading={actionLoading === "pin"} onClick={() => doAction("pin")} />
						)}
						{result!.actions.includes("add-to-group") && (
							<ActionButton label="加入分组" icon="📂" loading={actionLoading === "add-to-group"} onClick={() => setShowGroupSelector(!showGroupSelector)} />
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Action Button ──────────────────────────────────────────────────

function ActionButton({ label, icon, loading, onClick }: { label: string; icon: string; loading: boolean; onClick: () => void }) {
	return (
		<button
			className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium
				rounded-lg bg-primary/10 text-primary hover:bg-primary/20
				border border-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
			disabled={loading}
			onClick={onClick}
		>
			{loading ? (
				<svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
					<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
					<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
				</svg>
			) : (
				<span>{icon}</span>
			)}
			{label}
		</button>
	);
}
