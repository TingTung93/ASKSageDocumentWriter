# Repository Guidelines

## Project Structure & Module Organization

This is a zero-backend Vite, React, and TypeScript SPA. Main application code lives in `src/`: `components/` contains reusable UI, `routes/` contains page-level views, and `lib/` contains domain logic for providers, document parsing/editing, drafting, export, settings, and IndexedDB state. Test setup and DOCX fixtures are in `src/test/`. Built output is written to `release/index.html`, which is intentionally tracked as the deployable single-file artifact. `docs/` holds design notes and audits. `Version2/` is legacy/reference material; prefer the root `src/` app for active changes.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` starts the Vite dev server, usually at `http://localhost:5173`.
- `npm run build` runs `tsc --noEmit` and builds the single-file release artifact.
- `npm test` runs the Vitest suite once.
- `npm run test:watch` runs Vitest in watch mode.
- `npm run typecheck` runs strict TypeScript checks without building.
- `npm run preview` serves the production build locally.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings. Follow the existing style: two-space indentation, single quotes, semicolons, named exports for shared helpers/components, and `PascalCase` for React components. Use `camelCase` for functions and variables, and keep test files beside the code they cover with `.test.ts` or `.test.tsx` suffixes. There is no separate lint script; `npm run typecheck` and `npm test` are the required quality gates.

## Testing Guidelines

Tests use Vitest, jsdom, React Testing Library, and `@testing-library/jest-dom`, configured in `vite.config.ts` and `src/test/setup.ts`. Add focused unit tests for `src/lib` behavior and render/interaction tests for UI changes. Use synthetic DOCX fixtures under `src/test/fixtures/`; update fixture generation only when parser/export behavior truly changes.

## Commit & Pull Request Guidelines

Recent history uses semantic release-style subjects such as `fix: ...`, `feat: ...`, and `chore: ...`, plus version tag commits like `0.4.1`. Keep commits scoped and imperative. Pull requests should describe the user-facing change, note test commands run, link related issues or PR comments, and include screenshots for visible UI changes. Call out changes to `release/index.html`, provider behavior, or document-export semantics explicitly.

## Security & Configuration Tips

Do not commit API keys or sensitive documents. The app stores provider keys in browser session storage; keep `.secrets` empty and use synthetic fixtures for tests. Treat Ask Sage health.mil defaults as environment-specific and avoid hard-coding new credentials or private endpoints.
