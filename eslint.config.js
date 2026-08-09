import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import stylistic from "@stylistic/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "examples/vite/dist/**",
      "node_modules/**",
      "playwright-report/**",
      "release-artifacts/**",
      "test-results/**",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Deferred until adapter mocks and callback APIs can be tightened separately.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{cjs,js,mjs}"],
  },
  eslintConfigPrettier,
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxBOF: 0, maxEOF: 0 }],
      "@stylistic/padded-blocks": ["error", "never"],
    },
  },
);
