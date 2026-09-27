import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    coverage: {
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      // Drag and drop and the root layout only run in a real browser; Playwright covers them.
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/app/layout.tsx"],
      // A floor, not a target: CI fails if coverage drops below it.
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
    },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "tests"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
