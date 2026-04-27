# CLAUDE.md — frontend

React 18 + Vite SPA. See repo-root `CLAUDE.md` for the bigger picture; this file covers frontend-specific working knowledge.

## Dev server

```bash
npm run dev
```

Vite serves on `:5173` and proxies `/api` and `/ws` to `http://localhost:8000` (`vite.config.js`). The backend must be running separately — there is no concurrently-style script.

`VITE_API_BASE_URL` overrides the API base in `src/services/api.js`; default is `/api` so the proxy handles it.

## Tests

Vitest with jsdom. `src/test-setup.js` only loads `@testing-library/jest-dom/vitest` matchers. Globals are enabled (`describe`, `it`, `expect` are available without import).

```bash
npm test                                     # full run
npm test -- src/hooks/useChat.test.js        # one file
npm test -- -t "renders the candidate list"  # by name
npm run test:coverage                        # coverage (v8 provider, html report)
```

Coverage excludes `main.jsx`, `test-setup.js`, and `*.test.{js,jsx}` (see `vite.config.js`).

`scripts/verify-m*.mjs` are milestone smoke scripts run manually — they are not part of `npm test`.

## Structure

- `App.jsx` — router (react-router-dom v6). Routes: `/`, `/roles/new`, `/roles/:roleId` (setup), `/roles/:roleId/workspace`.
- `components/` — one folder per feature (`RoleList`, `RoleSetup`, `Workspace`, `HealthBadge`). Tests are colocated as `Foo.test.jsx`.
- `hooks/useChat.js` and `hooks/useProgress.js` — own the WebSocket lifecycles (chat and progress respectively). UI components consume their state, never poke the socket directly.
- `services/api.js` — single REST client with a `request()` helper that handles 204s, JSON-or-text parsing, and `err.status` propagation. `api.ws.chat(roleId)` / `api.ws.progress(roleId)` build the WebSocket URLs.

## State conventions

- Backend is the source of truth. The frontend is stateless across reloads — no localStorage caching of role/candidate data.
- The `?tab=` query string drives `RoleSetup` view switching (criteria vs. resumes); preserve it when navigating between modes.
- Chat `ui_mutations` arrive on `chat_complete` as a single accumulated payload (highlights + sort), not as a stream. Apply them atomically in the consumer of `useChat` via `onMutations`.
- StrictMode is on — effects run twice in dev. WebSocket hooks are written to tolerate this (see commit 0913a93 for the chat-banner fix). Don't disable StrictMode to mask races; fix the cleanup.

## UI testing notes

- Use `@testing-library/react` + `user-event` (already a devDep). Prefer queries by role/label over test IDs.
- WebSocket-driven components: stub `api.ws.*` at the module boundary rather than mocking `WebSocket` globally — see `useChat.test.js` for the pattern.
- For UI changes, run the dev server and exercise the feature in a browser before claiming it works. Test suites verify code, not behavior.
