// @ts-check
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "src/generated/**", "eslint.config.js"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      // This is a CommonJS project (package.json "type": "commonjs") that
      // deliberately uses `import x = require("x")` throughout utils/app.ts.
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
