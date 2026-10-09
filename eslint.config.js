import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "upstream/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/core/**/*.ts", "packages/interpreter/**/*.ts"],
    rules: {
      // Core and interpreter must stay platform-independent (browser, Node, worker).
      "no-restricted-globals": ["error", "window", "document", "process", "Buffer"],
    },
  },
);
