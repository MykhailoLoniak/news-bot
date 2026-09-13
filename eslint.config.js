module.exports = [
  { ignores: ["node_modules/**", "coverage/**", "data/**", "docs/**"] },
  {
    languageOptions: { ecmaVersion: 2023, sourceType: "commonjs" },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-constant-condition": "error",
      "no-undef": "off",
    },
  },
];
