import { defineTool } from "./types";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { updateRegistryFile, GENERATED_SRC_DIR } from "./registry-utils";
import { validateComponentCode, dryRunRender } from "./component-validator";
import { db } from "../../db";
import { dynamicCommands } from "../../db/schema";
import { eq } from "drizzle-orm";

export const registerComponentTool = defineTool({
	description: `注册新的 UI 组件到动态组件注册表，立即生效（无需重启）。同时更新 DB 中的 component_code。

		**推荐使用 create-command 代替本工具**，它一步完成命令注册和组件注册。

		组件代码必须先写入文件，再通过 codePath 引用（避免 JSON 转义问题）。`,
	inputSchema: z.object({
		name: z
			.string()
			.describe(
				'命令名称（必须与已有命令名完全一致，不加 -panel/-card 等后缀）。如 /word-stats 命令对应 name="word-stats"，不是 "word-stats-panel"。',
			),
		codePath: z
			.string()
			.describe(
				'组件代码文件路径（必须先写入文件再引用，避免 JSON 转义问题）。如 "generated/components/word-match-panel.tsx"',
			),
	}),
	execute: async ({ name, codePath }) => {
		// In pi SDK mode, files are written directly by pi built-in write tool.
		// No need to flush file blocks.

		// Resolve code from either direct string or file path
		let componentCode: string;
		if (codePath) {
			const fullPath = path.join(process.cwd(), codePath);
			const normalized = path.normalize(fullPath);
			if (!normalized.startsWith(path.normalize(process.cwd()))) {
				return {
					type: "error",
					message: "安全限制：codePath 必须在项目目录内",
				};
			}
			try {
				componentCode = await fs.readFile(normalized, "utf-8");
			} catch {
				return {
					type: "error",
					message: `组件代码文件不存在: ${codePath}。请先用 file-write 写入代码文件。`,
				};
			}
		} else {
			return {
				type: "error",
				message:
					"必须提供 codePath 参数（先写入文件再引用，避免 JSON 转义问题）",
			};
		}

		try {
			// 0. Validate component code (syntax + null-safety + structure)
			const validation = validateComponentCode(componentCode, name);
			if (!validation.valid) {
				return {
					type: "error",
					errorType: "component-validation",
					message: `组件代码验证失败:\n${validation.errors.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
					hint: "修复以上问题后重新调用 register-component。",
				};
			}

			// 0b. Dry-run TSX compilation
			const dryRun = await dryRunRender(name, componentCode);
			if (!dryRun.ok) {
				return {
					type: "error",
					errorType: "component-compilation",
					message: dryRun.error!,
					hint: "修复编译错误后重新调用 register-component。",
				};
			}

			// 0c. Include warnings in the result (non-blocking)
			const warningLines =
				validation.warnings.length > 0
					? `\n\n⚠️ 注意:\n${validation.warnings.map((w, i) => `${i + 1}. ${w}`).join("\n")}`
					: "";

			// 1. Save the component code to src/components/generated/
			await fs.mkdir(GENERATED_SRC_DIR, { recursive: true });
			const componentPath = path.join(GENERATED_SRC_DIR, `${name}.tsx`);
			await fs.writeFile(componentPath, componentCode, "utf-8");

			// 2. Update component-registry.ts (triggers Turbopack HMR)
			await updateRegistryFile();

			// 3. Update the dynamic_commands table if a matching command exists
			try {
				const now = new Date();

				const candidates = [name, name.replace(/-/g, "_")];
				for (const candidate of candidates) {
					const existing = await db
						.select()
						.from(dynamicCommands)
						.where(eq(dynamicCommands.name, candidate))
						.limit(1);
					if (existing.length > 0) {
						await db
							.update(dynamicCommands)
							.set({ componentCode: componentCode, updatedAt: now })
							.where(eq(dynamicCommands.name, candidate));
						break;
					}
				}
			} catch (dbErr) {
				console.error("[register-component] DB update failed:", dbErr);
			}

			return {
				type: "registered",
				name,
				message: `组件 "${name}" 已注册。Turbopack HMR 会自动热更新，稍等片刻即可使用。${warningLines}`,
			};
		} catch (error) {
			return { type: "error", message: `注册组件失败: ${String(error)}` };
		}
	},
});
