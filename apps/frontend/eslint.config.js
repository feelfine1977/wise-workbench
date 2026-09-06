import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "public/mockServiceWorker.js", "playwright-report", "test-results"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true, allowExportNames: ["buttonVariants", "useTrackJob", "makeQueryClient", "backlogExplain", "emphasise", "hotspotGlyph", "stabilityGlyph", "gateGlyph", "layerColor", "layerDecal", "runStatusVariant", "runStatusGlyph", "rootRoute", "indexRoute", "projectsRoute", "projectRoute", "dashboardRoute", "dataRoute", "datasetRoute", "normsRoute", "normRoute", "runsRoute", "runRoute", "backlogRoute", "sliceRoute", "routeTree", "createAppRouter"] }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
