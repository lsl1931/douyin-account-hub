# Windows / DSH environment constraints

> Every entry below cost real debugging time. They are recorded here so the next
> session recognises the symptom instead of re-deriving the cause.

---

## 1. Executables must not be launched from inside the DSH workspace directory

**General rule, established by two independent incidents:** an `.exe` whose image lives
under the session workspace (`C:\Users\sqdx66\Desktop\agent工作区\dy\`) is impaired even
when the session runs at `danger-full-access`. Copy the same binary outside the workspace
and it behaves normally. The failure mode differs per program, which is what makes this
so expensive to diagnose — it looks like two unrelated bugs.

| Program | Run from inside `dy` | Run from outside `dy` |
|---|---|---|
| `electron.exe` | exits `-2147483645` (`STATUS_BREAKPOINT`), stderr only `crashpad_client_win.cc: not connected` | ✅ exit 0 |
| `makensis.exe` (NSIS compiler) | `Can't open output file`, and `!tempfile: Unable to create temporary file!` | ✅ exit 0, output produced |

### 1a. Electron

**Symptom.** Launching the Electron binary under the workspace exits immediately with
`exit=-2147483645` (`STATUS_BREAKPOINT`). stderr carries a single line:

```
crashpad_client_win.cc: not connected
```

No window, no other diagnostics.

**Not the cause** (each ruled out by a controlled experiment, same binaries, same app code):

| Location | Result |
|---|---|
| `C:\edist-test` (pure ASCII) | ✅ exit 0 |
| `C:\edist-工作区-test` (non-ASCII, outside workspace) | ✅ exit 0 |
| `C:\Users\sqdx66\Desktop\edist-test` | ✅ exit 0 |
| `C:\Users\sqdx66\Desktop\agent工作区\edist-test` (parent of workspace) | ✅ exit 0 |
| workspace `dy\.edist-test` | ❌ crash |
| **exe outside `dy`, app code inside `dy`** | ✅ exit 0 |

So: **non-ASCII paths are fine. Only the executable's location matters, and only the
workspace directory is affected.** The workspace carries two extra non-inherited ACEs
(`Everyone: Deny DeleteSubdirectoriesAndFiles`, `S-1-4-*: Allow Write/Delete`) that its
parent does not. Presence of a deny is not by itself proof of causation, but the
correlation is exact across six runs.

**What to do.** Deploy the runtime outside the workspace (we use
`%LOCALAPPDATA%\DouyinAccountHub\runtime\`) and keep source code in the workspace.
This is also where a normally installed Windows app belongs.

### 1b. NSIS (`makensis.exe`) — this is what breaks `electron-builder` packaging

**Symptom.** `npx electron-builder --win` gets all the way through packing (`app.asar`,
`.nsis.7z`, `win-unpacked/` are all produced) and then dies compiling the installer:

```
!tempfile: Unable to create temporary file!
Error in macro _Switch on macroline 8
Error in macro FUNCTION_INSTALL_MODE_PAGE_FUNCTION on macroline 126
...
Error in script "<stdin>" on line 119 -- aborting creation process
```

Reduce it to a two-line script and the real error surfaces — `makensis` cannot write
**any** file, not just temp files:

```
OutFile "plain.exe"
Section
SectionEnd
```
→ `Can't open output file`

`TEMP`/`TMP` are set and writable, the output directory is writable, and it fails the
same way with a redirected `TEMP`, with DSH env vars stripped, and from an ASCII project
directory. The only variable that matters is where `makensis.exe` itself lives:

| `makensis.exe` location | Result |
|---|---|
| `<workspace>\.electron-builder-cache\nsis-3.0.4.1\...` | ❌ `Can't open output file` |
| `C:\nsis-out\nsis\makensis.exe` (same files, copied out) | ✅ exit 0, output written |

**Fix.** Keep `ELECTRON_BUILDER_CACHE` **outside** the workspace. electron-builder
extracts NSIS into that cache and runs it from there, so pointing the cache at the
default `%LOCALAPPDATA%\electron-builder\Cache` is enough — just do not override it to a
path inside the workspace. `npm run pack` already relies on the default.

> Do not "fix" this by giving the temp directory more permissions or by switching NSIS
> versions. Both waste time: the compiler is fine, its address is not.

---

## 2. `.cmd` files must be pure ASCII — including comments

**Symptom A.** A generated uninstaller ran, printed nothing, and deleted nothing.
**Symptom B.** `start.cmd` reported `'<garbage>' is not recognized as an internal or
external command` — the error pointed nowhere near the real cause.

**Cause.** `cmd.exe` reads `.cmd` files using the system ANSI code page. UTF-8 Chinese
text (written by a UTF-8 editor) is decoded as garbage bytes. If those bytes include
`&`, `>`, `<`, `|`, or `"`, parsing breaks — and `rem` lines are **not** exempt, because
cmd splits on `&` before `rem` ever sees the line.

Both incidents happened inside comments, which is exactly why they were missed: comments
look harmless.

**What to do.**
- Keep `.cmd` content ASCII-only, names included.
- `src/test/cmdEncoding.test.ts` scans every `*.cmd` in the repo for bytes > 0x7F and
  fails the build. Do not weaken it.
- For anything with real logic (path handling, conditional work, registry writes),
  write a Node/PowerShell script and let the `.cmd` only set environment variables and
  forward.

---

## 3. Cache directories must be redirected when running under the DSH sandbox

| What | Wrong value | Right value |
|---|---|---|
| npm cache | default `%LOCALAPPDATA%\npm-cache` → `EPERM` | `npm_config_cache=<repo>\.npm-cache` |
| Electron binary cache | `ELECTRON_CACHE` (ignored!) | **`electron_config_cache`** |

`@electron/get` resolves its cache root with `env-paths('electron')`; the only override
it honours is `cacheRoot: process.env.electron_config_cache` passed by electron's
`install.js`. `ELECTRON_CACHE` is a decoy.

Also needed behind slow/blocked CDNs: `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`.

---

## 4. `ELECTRON_RUN_AS_NODE=1` is injected by DSH terminals

The variable makes `electron.exe` behave as plain Node. `require('electron')` then
resolves to the npm package and returns a path **string**, so destructuring gives
`app === undefined`, and the error is:

```
TypeError: Cannot read properties of undefined (reading 'getPath')
```

Nothing in that message hints at the real cause.

**What to do.** Every launcher clears it: `set "ELECTRON_RUN_AS_NODE="`.
It does not exist when the user double-clicks from Explorer, but it does in any terminal
this agent runs, so scripts that skip this step will work for the user and fail for the agent.

---

## 5. `child_process.execFileSync` blocks the event loop

If a script starts a local HTTP server and then calls `execFileSync` to drive a browser
against that server, the server **never responds** — the event loop is blocked inside the
synchronous call. The browser waits forever and the parent reports `ETIMEDOUT`.

**What to do.** Use the async form (`promisify(execFile)`) whenever the same process must
keep serving something.

---

## 6. `chrome.exe` is a GUI-subsystem program

PowerShell's call operator (`& chrome.exe ...`) neither waits for it nor captures its
stdout — it returns in ~7 ms with empty output and looks like "Chrome did nothing".

**What to do.** Use Node's `execFile` (pipes work), or
`Start-Process -RedirectStandardOutput/-RedirectStandardError`.

---

## 7. `--virtual-time-budget` stops headless Chrome from exiting

With `--headless=new --dump-dom`, adding `--virtual-time-budget=3000` makes Chrome hang
until the parent times out, because it waits on virtual time while background networking
keeps the page busy. Without it, `--dump-dom` dumps and exits in ~2 s.

**What to do.** For one-shot DOM scraping, omit it. If background services still slow
startup, add `--disable-background-networking --disable-component-update --disable-sync
--disable-default-apps --disable-extensions --no-service-autorun`.

---

## 8. Verifying a Chromium deliverable from a sandboxed shell

Under the confined sandbox modes, Chromium cannot start at all
(`crashpad_client_win.cc: OpenProcess: 拒绝访问 (0x5)` →
`crash server failed to launch, self-terminating`), for both Chrome and Electron.
Granting the session `danger-full-access` lifts it.

Design consequence, not a workaround: split verification into layers so most of it is
provable without a browser —

| Layer | Covered by | Needs Chromium |
|---|---|---|
| L1 logic | `node --test` on pure functions | no |
| L2 static | `tsc --noEmit` | no |
| L3 end-to-end | real Electron + real Chrome | yes |

To make L1 possible, keep the launch path split into a pure `buildLaunchArgs()` and a
thin `spawnBrowser()`.
