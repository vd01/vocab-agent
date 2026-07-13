import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  {
    extends: ["next/core-web-vitals", "next/typescript"],
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
