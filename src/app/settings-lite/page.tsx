"use client";

import { useState, useEffect } from "react";

export default function SettingsLitePage() {
	const [serverUrl, setServerUrl] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [status, setStatus] = useState("");
	const [shortcut, setShortcut] = useState("");
	const [capturing, setCapturing] = useState(false);
	const [shortcutSaving, setShortcutSaving] = useState(false);
	const [shortcutError, setShortcutError] = useState("");
	const [shortcutHint, setShortcutHint] = useState("点击输入框后按下组合键");

	function getInvoke() {
		try {
			// @ts-expect-error Tauri internal API
			return window.__TAURI_INTERNALS__.invoke ?? null;
		} catch {
			return null;
		}
	}

	useEffect(() => {
		const invoke = getInvoke();
		if (!invoke) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		invoke("config-get")
			.then((cfg: any) => {
				if (cfg.server_url) setServerUrl(cfg.server_url);
				if (cfg.quick_lookup_shortcut) setShortcut(cfg.quick_lookup_shortcut);
			})
			.catch(() => {});
	}, []);

	async function connect() {
		const url = serverUrl.trim().replace(/\/+$/, "");
		if (!url) {
			setError("请输入服务端地址");
			return;
		}
		try {
			new URL(url);
		} catch {
			setError("地址格式不正确");
			return;
		}

		setError("");
		setSaving(true);
		setStatus("正在检测服务端...");

		const invoke = getInvoke();
		if (!invoke) {
			setError("Tauri API 不可用");
			setSaving(false);
			return;
		}

		try {
			const ok = await invoke("check-server", { url });
			if (!ok) throw new Error("服务端返回异常状态");
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setError("无法连接到服务端: " + msg);
			setSaving(false);
			setStatus("");
			return;
		}

		setStatus("正在保存配置...");
		try {
			await invoke("config-set", { partial: { server_url: url } });
			setStatus("✓ 配置已保存，主窗口将自动跳转");
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setError("保存失败: " + msg);
			setSaving(false);
			setStatus("");
			return;
		}
		setSaving(false);
	}

	function handleShortcutCapture(e: React.KeyboardEvent) {
		if (!capturing) return;
		e.preventDefault();

		const parts: string[] = [];
		if (e.ctrlKey) parts.push("Ctrl");
		if (e.altKey) parts.push("Alt");
		if (e.shiftKey) parts.push("Shift");
		if (e.metaKey) parts.push("Super");

		const key = e.key;
		if (!["Control", "Alt", "Shift", "Meta"].includes(key)) {
			parts.push(key.length === 1 ? key.toUpperCase() : key);
		}

		if (parts.length >= 2) {
			setShortcut(parts.join("+"));
			setCapturing(false);
			setShortcutHint("快捷键已捕获，点击保存确认");
		}
	}

	async function saveShortcut() {
		if (!shortcut.trim()) return;
		const invoke = getInvoke();
		if (!invoke) return;

		setShortcutSaving(true);
		setShortcutError("");
		try {
			await invoke("set-quick-lookup-shortcut", { shortcut: shortcut.trim() });
			setShortcutHint("✓ 快捷键已保存: " + shortcut);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			setShortcutError("保存失败: " + msg);
		}
		setShortcutSaving(false);
	}

	return (
		<div
			className="min-h-screen bg-background p-6 max-w-md mx-auto select-none"
			onKeyDown={handleShortcutCapture}
		>
			<h1 className="text-lg font-semibold mb-1">Vocab Agent Lite</h1>
			<p className="text-sm text-muted-foreground mb-6">配置服务端连接</p>

			{/* Server URL */}
			<div className="space-y-2 mb-4">
				<label className="text-sm text-muted-foreground">服务端地址</label>
				<input
					type="url"
					value={serverUrl}
					onChange={(e) => setServerUrl(e.target.value)}
					placeholder="https://example.duckdns.org:31588"
					className="w-full px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
					onKeyDown={(e) => {
						if (e.key === "Enter" && !capturing) connect();
					}}
				/>
			</div>
			<button
				className="w-full py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
				onClick={connect}
				disabled={saving}
			>
				{saving ? "连接中..." : "连接"}
			</button>
			{error && <p className="text-sm text-destructive mt-2">{error}</p>}
			{status && <p className="text-sm text-muted-foreground mt-2">{status}</p>}

			{/* Divider */}
			<hr className="border-border my-6" />

			{/* Quick Lookup Shortcut */}
			<h2 className="text-sm font-medium mb-3">快捷键设置</h2>
			<div className="space-y-2 mb-4">
				<label className="text-sm text-muted-foreground">快捷查词快捷键</label>
				<input
					type="text"
					value={shortcut}
					onChange={(e) => setShortcut(e.target.value)}
					onFocus={() => {
						setCapturing(true);
						setShortcutHint("请按下组合键...");
					}}
					onBlur={() => {
						setCapturing(false);
						if (!shortcut) setShortcutHint("点击输入框后按下组合键");
					}}
					placeholder={capturing ? "请按下组合键..." : "点击输入框后按下组合键"}
					readOnly={capturing}
					className={`w-full px-3 py-2 text-sm border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors ${capturing ? "bg-primary/10 border-primary ring-2 ring-primary/50" : "bg-muted/50 border-border focus:ring-2 focus:ring-primary/50"}`}
				/>
				<p className="text-xs text-muted-foreground">{shortcutHint}</p>
			</div>
			<button
				className="w-full py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
				onClick={saveShortcut}
				disabled={!shortcut.trim() || shortcutSaving}
			>
				{shortcutSaving ? "保存中..." : "保存快捷键"}
			</button>
			{shortcutError && (
				<p className="text-sm text-destructive mt-2">{shortcutError}</p>
			)}
		</div>
	);
}
