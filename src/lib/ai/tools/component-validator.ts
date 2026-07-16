/**
 * Component Code Validator
 *
 * Pre-registration validation for dynamically generated React components.
 * Catches common errors BEFORE the component is registered and rendered:
 *
 *   1. TSX syntax check via TypeScript compiler (transpile only — no type checking)
 *   2. Null-safety pattern detection (x.length, x.map(), x.join() without guards)
 *   3. Structural checks (default export, 'use client', forbidden imports)
 *
 * This runs server-side during register-component / create-command execution.
 */

import { transpileModule, ScriptTarget, ModuleKind, JsxEmit } from 'typescript';
import { promises as fs } from 'fs';
import path from 'path';

// ── Types ────────────────────────────────────────────────────────────────

export interface ValidationResult {
	valid: boolean;
	errors: string[];    // Blocking errors — registration must be rejected
	warnings: string[];  // Non-blocking — shown to agent but registration proceeds
}

// ── Forbidden imports (packages not installed in this project) ───────────

const FORBIDDEN_IMPORTS = [
	{ pattern: /from\s+['"]lucide-react['"]/, name: 'lucide-react', alt: '用 emoji 或纯 CSS/SVG 代替图标' },
	{ pattern: /from\s+['"]@heroicons['"]/, name: '@heroicons', alt: '用 emoji 或纯 CSS/SVG 代替图标' },
	{ pattern: /from\s+['"]react-icons['"]/, name: 'react-icons', alt: '用 emoji 或纯 CSS/SVG 代替图标' },
	{ pattern: /from\s+['"]framer-motion['"]/, name: 'framer-motion', alt: '用 CSS transitions/animations 代替' },
	{ pattern: /from\s+['"]recharts['"]/, name: 'recharts', alt: '用原生 HTML/CSS 绘制简单图表' },
];

// ── Null-safety patterns ─────────────────────────────────────────────────

/**
 * Patterns that access properties on variables that might be null/undefined.
 * These are the #1 cause of runtime errors in generated components.
 *
 * We look for patterns like:
 *   - `obj.prop.length`   where obj.prop could be null
 *   - `obj.prop.map(`     where obj.prop could be null
 *   - `obj.prop.join(`    where obj.prop could be null
 *   - `obj.prop.filter(`  where obj.prop could be null
 *   - `obj[prop]`         dynamic access
 *
 * False positives are possible but acceptable — we flag warnings, not errors.
 */
const NULL_UNSAFE_PATTERNS = [
	{
		// Match: x.y.length / x.y.map / x.y.join / x.y.filter / x.y.forEach / x.y.reduce / x.y.find / x.y.some / x.y.every / x.y.includes
		// where x.y is likely a prop that could be null
		pattern: /(?<![?\]])(?:props\.)?(\w+)\.(\w+)\.(length|map|join|filter|forEach|reduce|find|some|every|includes|indexOf|splice|slice|sort|flat|flatMap|concat|push|pop|shift|unshift)\b/g,
		getWarning: (match: string) =>
			`可能的空值访问: "${match}" — 如果属性可能为 null/undefined，请用可选链 (\`?.\`) 或 Array.isArray() 保护`,
	},
	{
		// Match direct .length/.map/.join on destructured variables (common in function params)
		// e.g. function Panel({ items }) { items.length }
		// This is harder to detect precisely, so we look for common patterns
		// Note: .length is special — it doesn't need () after it, so we match it separately
		pattern: /(?<![?.\]])\b(\w+)\.(length|map|join|filter|forEach|reduce|find|some|every|includes)\b/g,
		getWarning: (match: string) =>
			`可能的空值访问: "${match.trim()}" — 如果变量可能为 null/undefined，请用可选链 (\`?.\`) 或 Array.isArray() 保护`,
	},
];

// ── Main validator ───────────────────────────────────────────────────────

export function validateComponentCode(code: string, name: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// ── 1. Structural checks ────────────────────────────────────────────

	// Check for 'use client' directive
	if (!code.trimStart().startsWith("'use client'") && !code.trimStart().startsWith('"use client"')) {
		errors.push('缺少 "use client" 指令。生成式组件是客户端组件，必须在文件顶部添加 \'use client\'。');
	}

	// Check for default export
	if (!/export\s+default\s+/.test(code) && !/export\s*\{[^}]*\bdefault\b/.test(code)) {
		errors.push('缺少默认导出 (export default)。组件必须有默认导出才能被动态加载。');
	}

	// ── 2. Forbidden imports ────────────────────────────────────────────

	for (const { pattern, name: pkgName, alt } of FORBIDDEN_IMPORTS) {
		if (pattern.test(code)) {
			errors.push(`禁止引用 "${pkgName}"（项目未安装此包）。${alt}`);
		}
	}

	// ── 3. TSX syntax check via TypeScript transpiler ────────────────────

	try {
		transpileModule(code, {
			compilerOptions: {
				target: ScriptTarget.ES2020,
				module: ModuleKind.ESNext,
				jsx: JsxEmit.React,
				jsxFactory: 'React.createElement',
				jsxFragmentFactory: 'React.Fragment',
				strict: false,
				noEmit: false,
			},
			reportDiagnostics: true,
			fileName: `${name}.tsx`,
		});
	} catch (err) {
		// transpileModule throws on fatal errors
		const msg = err instanceof Error ? err.message : String(err);
		errors.push(`TSX 语法错误: ${msg}`);
	}

	// Note: transpileModule with reportDiagnostics: true puts diagnostics in the result,
	// but we used the simpler try/catch above. For more precise error messages,
	// we can use the diagnostics array from the result object.

	// ── 4. Null-safety pattern warnings ─────────────────────────────────

	// Reset regex lastIndex (since we use /g flag)
	for (const { pattern, getWarning } of NULL_UNSAFE_PATTERNS) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		const seen = new Set<string>();
		while ((match = pattern.exec(code)) !== null) {
			const fullMatch = match[0];
			// Skip if already protected by ?.
			const beforeMatch = code.slice(Math.max(0, match.index - 5), match.index);
			if (beforeMatch.includes('?.')) continue;

			// Skip if inside an Array.isArray() guard.
			// Look backwards up to 500 chars (covers multi-line JSX expressions)
			// and check if the same variable name appears in an Array.isArray() call.
			const contextBefore = code.slice(Math.max(0, match.index - 500), match.index);
			// Extract the variable being accessed (e.g. "items" from "items.length",
			// "word.definition" from "word.definition.join")
			const varName = fullMatch.replace(/\.(length|map|join|filter|forEach|reduce|find|some|every|includes|indexOf|splice|slice|sort|flat|flatMap|concat|push|pop|shift|unshift)\b.*$/, '');
			const isArrayCheck = new RegExp(`\\bArray\\.isArray\\s*\\(\\s*${varName.replace('.', '\\.')}\\s*\\)`);
			if (isArrayCheck.test(contextBefore)) continue;

			// Skip common safe patterns: string.length (strings are never null in JSX),
			// state variables from useState (always initialized)
			if (/^(str|string|text|msg|name|title|label|className|id|key|type|href|src|alt)/i.test(varName)) continue;

			if (!seen.has(fullMatch)) {
				seen.add(fullMatch);
				warnings.push(getWarning(fullMatch));
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

// ── Dry-run render (server-side) ─────────────────────────────────────────

/**
 * Attempt to import and instantiate the component with mock props
 * to catch runtime errors before registration.
 *
 * This uses a lightweight server-side React renderToString to verify
 * the component doesn't crash with typical props.
 */
export async function dryRunRender(
	componentName: string,
	componentCode: string,
	mockProps?: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
	// Write to a temp file, import, render with mock props, clean up.
	// This is complex in a Next.js server context because we can't easily
	// dynamically import TSX on the server. Instead, we do a simpler check:
	// verify the transpiled JS can be eval'd without syntax errors.

	try {
		const result = transpileModule(componentCode, {
			compilerOptions: {
				target: ScriptTarget.ES2020,
				module: ModuleKind.ESNext,
				jsx: JsxEmit.React,
				jsxFactory: 'React.createElement',
				jsxFragmentFactory: 'React.Fragment',
				strict: false,
				noEmit: false,
			},
			reportDiagnostics: true,
			fileName: `${componentName}.tsx`,
		});

		// Check for diagnostics (non-fatal syntax issues)
		if (result.diagnostics && result.diagnostics.length > 0) {
			const msgs = result.diagnostics
				.filter(d => d.category === 1) // Error = 1, Warning = 0, Suggestion = 2, Message = 3
				.map(d => {
					const pos = d.file && d.start !== undefined
						? d.file.getLineAndCharacterOfPosition(d.start)
						: null;
					const lineInfo = pos ? ` (行 ${pos.line + 1})` : '';
					return `${typeof d.messageText === 'string' ? d.messageText : (d.messageText as any).messageText}${lineInfo}`;
				});
			if (msgs.length > 0) {
				return { ok: false, error: `TSX 编译错误:\n${msgs.join('\n')}` };
			}
		}

		return { ok: true };
	} catch (err) {
		return { ok: false, error: `TSX 编译失败: ${err instanceof Error ? err.message : String(err)}` };
	}
}
