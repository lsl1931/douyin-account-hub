# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This is an Electron desktop app. The "backend" is the Electron main process under
`src/main/`, plus the preload bridge. There is no server, no database, and no ORM — user
state is a single JSON file.

The authoritative conventions live in **[conventions.md](./conventions.md)**. Start there.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Conventions](./conventions.md) | Layering, `Result<T>` error contract, atomic writes, process launching, renderer boundary | **Written — read this** |
| [Windows / DSH constraints](../guides/windows-and-dsh-constraints.md) | Environment landmines that cost real debugging time (Electron path, `.cmd` encoding, cache redirection) | **Written — read this** |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Not applicable — no separate layering beyond `conventions.md` |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | Not applicable — JSON file store, see `conventions.md` |
| [Error Handling](./error-handling.md) | Error types, handling strategies | Folded into `conventions.md` (Result contract) |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Folded into `conventions.md` |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | Folded into `conventions.md` |

> The scaffolded files above are intentionally left unfilled: splitting four small topics
> into four near-empty documents would hide the conventions instead of surfacing them.
> `conventions.md` is the single entry point.

---

## Common mistakes already made here

Recorded because they were actually hit, not hypothetically:

1. **Writing non-ASCII text into a `.cmd`.** It breaks parsing (even inside `rem`).
   Guarded by `src/test/cmdEncoding.test.ts`.
2. **Assuming a path problem is an encoding problem.** The workspace-directory Electron
   crash had nothing to do with the non-ASCII characters in the path.
3. **Using `unwrap()` on a `Result<null>`.** Success and failure both surface as `null`.

---

**Language**: documentation in this directory is written in English; user-facing docs
(`README.md`) are in Chinese.
