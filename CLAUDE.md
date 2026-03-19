# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup       # One-time setup: install deps, generate Prisma client, run migrations
npm run dev         # Start dev server with Turbopack at http://localhost:3000
npm run build       # Production build
npm run lint        # ESLint via Next.js
npm test            # Run Vitest unit tests
npm run db:reset    # Reset and re-migrate SQLite database
```

All run commands require the `node-compat.cjs` shim (already wired into the npm scripts via `NODE_OPTIONS`).

## Environment

Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without a key the app falls back to a mock provider that returns static code.

## Architecture

### Core Flow

```
User chat message
  → /api/chat (Vercel AI SDK + Claude claude-haiku-4-5)
  → Tool calls: str_replace_editor / file_manager
  → Virtual in-memory file system (src/lib/file-system.ts)
  → Preview iframe: JSX → Babel standalone → import map from esm.sh CDN
  → Monaco editor: reads same virtual FS
```

### Key Modules

| Path | Role |
|------|------|
| `src/app/api/chat/route.ts` | Streaming chat endpoint; registers AI tools |
| `src/lib/file-system.ts` | In-memory virtual FS (no disk writes) |
| `src/lib/provider.ts` | Anthropic model provider with mock fallback |
| `src/lib/tools/` | `str_replace_editor` (view/create/edit) and `file_manager` (rename/delete) |
| `src/lib/prompts/generation.tsx` | System prompt that instructs Claude to write `/App.jsx` as root, use Tailwind, use `@/` alias |
| `src/lib/contexts/chat-context.tsx` | Wraps Vercel AI SDK `useChat`; owns FS state |
| `src/components/preview/PreviewFrame.tsx` | Sandboxed iframe renderer |
| `src/components/editor/CodeEditor.tsx` | Monaco editor |
| `src/lib/auth.ts` | JWT sessions (7-day, httpOnly cookie) + bcrypt |
| `src/middleware.ts` | Protects project routes and auth-required API routes |
| `src/actions/index.ts` | Server actions for signUp / signIn / signOut / getUser |
| `prisma/schema.prisma` | SQLite schema: `User`, `Project` |

### Data Persistence

- **Anonymous users:** virtual FS state tracked in IndexedDB only.
- **Authenticated users:** project messages + FS data serialized and saved to SQLite via Prisma.
- **DB schema:** `prisma/schema.prisma` is the source of truth for all data models — check it whenever you need to understand the structure of data stored in the database.

### UI Layout

Resizable panels: Chat (35%) | Preview/Code (65%).
Code view splits into File Tree (30%) + Monaco Editor (70%).
All UI components come from shadcn/ui (New York style, Neutral base) + Tailwind CSS v4.

### AI Tool Constraints

The system prompt (`src/lib/prompts/generation.tsx`) enforces:
- Root component must be `/App.jsx`
- Style with Tailwind utility classes (no inline styles)
- Use `@/` import alias for local files
- Max 40 tool steps per conversation (4 for mock provider)
