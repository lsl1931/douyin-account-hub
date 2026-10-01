# Backend conventions (Electron main process)

> Observed from the actual code in this repo. Keep it that way: document what the code
> does, not what it ought to do.

## Layering

```
ipc.ts      transport only — validate input, call a module, wrap the result
  ↓
accountStore.ts / browserLocator.ts / browserLauncher.ts   pure-ish logic, no Electron import
  ↓
paths.ts    path resolution, zero Electron import
```

`paths.ts`, `accountStore.ts`, `browserLocator.ts` and `browserLauncher.ts`
**must not import `electron`**. That is what lets `node --test` cover them without a
display, a browser, or a sandbox escape. Electron-specific defaults are injected by the
caller (`resolveHubRoot({ fallback: app.getPath('userData') })`).

## Errors: `Result<T>`, never reject

```ts
type Result<T> = { ok: true; data: T } | { ok: false; code: ErrorCode; message: string };
```

`ipcRenderer.invoke` serialises a thrown error across the process boundary and loses
`code`, leaving the renderer unable to distinguish "no browser found" from "disk write
failed". Every handler returns a `Result`; `fromError()` in `result.ts` converts
unexpected throws.

**Gotcha:** `Result<null>` makes success and failure indistinguishable through a helper —
`succeeded` and `data === null` are different things. Check `result.ok` directly for
`null`-payload calls (see `removeAccount` in `renderer.ts`).

## Filesystem

- `accounts.json` is the single source of truth and is written **atomically**:
  write `<file>.tmp`, then `fs.renameSync` over the target. On Windows `rename` maps to
  `MoveFileEx(MOVEFILE_REPLACE_EXISTING)`, so no half-written file is ever visible.
- A corrupt `accounts.json` is **renamed to `accounts.json.corrupt-<ts>`**, never
  deleted, and the app starts empty with a visible warning. Silent data loss is the one
  unacceptable outcome.
- `runtime/` and `data/` under `HUB_ROOT` stay strictly separate: `runtime` is replaced
  wholesale on upgrade and deleted on uninstall; `data` holds user state. Uninstall must
  be expressible as "delete these two directories".

## Process launching

- `buildLaunchArgs(spec): string[]` is a **pure function**; `spawnBrowser` is a thin
  adapter. Never build a command line by string concatenation — Node maps the array to
  argv directly, so paths with spaces or non-ASCII characters need no quoting (adding
  quotes puts them *into* the path).
- Spawn the browser with `{ detached: true, stdio: 'ignore' }` + `child.unref()`. The
  browser must outlive the panel.
- Log the full command line before spawning. When a launch fails, that log line is the
  only self-contained evidence.

## Logging

`Logger` appends to `data/logs/app.log` and mirrors to the console. Failures to write the
log are swallowed on purpose — logging must never take down the operation it describes.
No logging library: the value here is a human-readable line the user can paste.

## Renderer boundary

`preload.ts` exposes an explicit method list via `contextBridge`; the raw `ipcRenderer`
is never exposed. The channel list in `preload.ts` and the `ipcMain.handle` list in
`ipc.ts` must correspond one-to-one — adding a handler without a preload method is dead
code, and vice versa is a runtime failure.
