/**
 * Shared utilities — extracted from message-item.tsx
 */

/**
 * Check if a message part is a tool part (AI SDK V7: type starts with 'tool-').
 * Returns the tool metadata if it is, or null otherwise.
 */
export function parseToolPart(part: any): {
	toolCallId: string;
	toolName: string;
	state: string;
	input: any;
	output: any;
	errorText?: string;
} | null {
	if (!part || typeof part.type !== "string") return null;

	if (part.type.startsWith("tool-")) {
		return {
			toolCallId: part.toolCallId,
			toolName: part.toolName ?? part.type.replace(/^tool-/, ""),
			state: part.state,
			input: part.input,
			output: part.output,
			errorText: part.errorText,
		};
	}

	return null;
}

/** Format a Date as a time string (HH:MM today, or MM-DD HH:MM) */
export function formatTime(date: Date): string {
	const now = new Date();
	const isToday = date.toDateString() === now.toDateString();

	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const time = `${hours}:${minutes}`;

	if (isToday) return time;

	const month = (date.getMonth() + 1).toString().padStart(2, "0");
	const day = date.getDate().toString().padStart(2, "0");
	return `${month}-${day} ${time}`;
}

/** Tool display names for Chinese UI */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
	"file-read": "读取文件",
	"file-list": "列出文件",
	"file-write": "写文件(引导)",
	"file-edit": "编辑文件(引导)",
	"create-command": "创建命令",
	"register-tool": "注册命令",
	"register-component": "注册组件",
	"db-query": "查询数据库",
	"fsrs-review": "获取复习单词",
	"fsrs-rate": "提交评分",
	"add-word": "添加单词",
	"vocab-lookup": "查询单词",
	"extract-words": "提炼生词",
	"save-lesson": "保存经验",
	"list-lessons": "列出经验",
	"merge-lessons": "合并经验",
	"test-command": "测试命令",
	"dict-lookup": "查词典",
	"vocab-stats": "词库统计",
	"safe-ls": "列出目录",
	read: "读取文件",
	write: "写文件",
	edit: "编辑文件",
	readSeek_read: "读取文件",
	readSeek_write: "写文件",
	readSeek_edit: "编辑文件",
	readSeek_grep: "搜索内容",
	readSeek_search: "语法搜索",
	readSeek_refs: "查找引用",
	readSeek_rename: "重命名",
	readSeek_hover: "查看符号",
	readSeek_def: "查找定义",
	readSeek_check: "语法检查",
};

/** Developer tool icon/label map */
export const DEV_TOOL_LABELS: Record<string, { icon: string; label: string }> =
	{
		"file-read": { icon: "R", label: "读取文件" },
		"file-list": { icon: "L", label: "列出文件" },
		"file-write": { icon: "⚠", label: "写文件(引导)" },
		"file-edit": { icon: "⚠", label: "编辑文件(引导)" },
		"register-tool": { icon: "T", label: "注册工具" },
		"register-component": { icon: "C", label: "注册组件" },
		"create-command": { icon: "!", label: "创建命令" },
		"db-query": { icon: "D", label: "查询数据库" },
		"save-lesson": { icon: "S", label: "保存经验" },
		"list-lessons": { icon: "📋", label: "列出经验" },
		"merge-lessons": { icon: "🔗", label: "合并经验" },
		"test-command": { icon: "?", label: "测试命令" },
		"safe-ls": { icon: "L", label: "列出目录" },
		read: { icon: "R", label: "读取文件" },
		write: { icon: "W", label: "写文件" },
		edit: { icon: "E", label: "编辑文件" },
		readSeek_read: { icon: "R", label: "读取文件" },
		readSeek_write: { icon: "W", label: "写文件" },
		readSeek_edit: { icon: "E", label: "编辑文件" },
		readSeek_grep: { icon: "G", label: "搜索内容" },
		readSeek_search: { icon: "S", label: "语法搜索" },
		readSeek_refs: { icon: "→", label: "查找引用" },
		readSeek_rename: { icon: "✎", label: "重命名" },
		readSeek_hover: { icon: "?", label: "查看符号" },
		readSeek_def: { icon: "D", label: "查找定义" },
		readSeek_check: { icon: "✓", label: "语法检查" },
	};

/** Developer tool names (for collapsed display) */
export const DEV_TOOL_NAMES = new Set([
	"file-read",
	"file-list",
	"register-tool",
	"register-component",
	"create-command",
	"db-query",
	"save-lesson",
	"list-lessons",
	"merge-lessons",
	"test-command",
	"file-write",
	"file-edit",
]);

/** Suppressed tool names (internal pi-readseek — output hidden from user) */
export const SUPPRESSED_TOOL_NAMES = new Set([
	"readSeek_read",
	"readSeek_edit",
	"readSeek_grep",
	"readSeek_search",
	"readSeek_refs",
	"readSeek_rename",
	"readSeek_hover",
	"readSeek_def",
	"readSeek_check",
	"readSeek_write",
	"read",
	"write",
	"edit",
]);
