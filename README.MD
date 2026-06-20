# System Information Collector & File Manager

A Node.js CLI that gathers system information (OS, CPU, memory, runtime
versions, user, environment variables) and performs CRUD operations on
files inside a sandboxed working directory.

Built for Thunder Hackathon 3.0. No external dependencies — pure Node.js
core modules (`os`, `fs`, `path`, `child_process`).

## Run it

```
node code.js --help
```

That prints every available command. Nothing runs automatically — the
program only does what you tell it to on the command line.

## What it collects, and why each field is safe to expose

| Field | Source | Notes |
|---|---|---|
| OS type / version / platform / architecture | `os.type()`, `os.release()`, `os.platform()`, `os.arch()` | Static system facts, no risk |
| Hostname | `os.hostname()` | Local machine name |
| Home directory | `os.homedir()`, falls back to `$HOME`/`$USERPROFILE` | Path only, not contents |
| CPU model / core count | `os.cpus()` | Hardware info |
| Memory (total/used/free/%) | `os.totalmem()`, `os.freemem()` | Computed, human-formatted |
| Node / NPM / Python versions | `process.version`, `npm -v`, `python --version` | Runtime versions only, via `execSync` with a 5s timeout so a missing binary can't hang the process |
| User info | `process.env.USER`, `os.userInfo()` | Username/UID/GID/shell, not credentials |
| Environment variables (`--env`) | A **fixed allowlist**: `PATH, HOME, USER, SHELL, LANG, NODE_ENV, PWD` | Deliberately not "dump everything" by default |
| Environment variables (`--env-all`) | Full `process.env` | Opt-in only; see Security section below |
| Uptime | `os.uptime()` | Formatted as `Xd Yh Zm` |

Every getter above is wrapped in its own try/catch (`safeGetOSType`,
`safeGetCpuModel`, etc.) so a single failed lookup degrades to a labeled
fallback ("Unknown", "Not Available") instead of crashing the whole
report. `collectSystemInfo()` itself is also wrapped, falling back to
`getDefaultSystemInfo()` as a last resort.

## Code flow

```
process.argv
     │
     ▼
main()
  ├─ strip out the --json modifier flag (works anywhere in the args)
  ├─ no command? → printHelp() and exit
  └─ command + args → dispatchCommand(collector, command, args, jsonMode)
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
     system-info commands   CRUD commands   --help / unknown
     (--all, --os, --cpu,   (create, read,   → usage text
      --memory, --node,      update, delete,
      --env, --env-all,      list)
      --user, --summary,
      --save-json)
              │                     │
              ▼                     ▼
     collectSystemInfo()    validateFileName() / validateFileContent()
     → extractSection()           → fs operations inside ./collected_files
     → printX() (console)
       or JSON.stringify (--json)
```

Key design choice: **information gathering and display are decoupled**.
`collectSystemInfo()` always returns one full plain object. The CLI
flags decide which slice of that object to show and in what format
(`extractSection()` for the JSON slice, `printXSection()` for the
human-readable block). Adding a new flag means adding one new section
and one new case in the dispatcher — no existing code has to change.

## Command reference

System information:
```
node code.js --all              full report
node code.js --os               OS, platform, arch, hostname, home dir
node code.js --cpu               CPU model + core count
node code.js --memory           total / used / free / usage %
node code.js --node              Node, NPM, Python versions
node code.js --env               allowlisted env vars (safe default)
node code.js --env-all          full process.env, secrets masked
node code.js --user              username, UID, GID, shell
node code.js --summary          one-line health verdict
node code.js --save-json [file] write the full report to JSON on disk
```
Add `--json` to any of the above to get raw JSON instead of the boxed
console report, e.g. `node code.js --memory --json` — useful for piping
into other tools or for the hackathon judges' automated checks.

CRUD (all scoped to `./collected_files`):
```
node code.js create <filename> [content]
node code.js read <filename>
node code.js update <filename> <content>
node code.js delete <filename>
node code.js list
```

## Error handling strategy

- Every OS/CPU/memory/version getter has its own try/catch + fallback
  value, so partial failures never take down the whole report.
- `npm -v` and `python --version` run through `execSync` with a 5-second
  timeout and silenced stdio, so a missing or hanging binary can't stall
  the CLI — it just reports "Unknown" / "Not Installed".
- File operations validate filename (charset, length, no `..` or path
  separators) and content size (10MB cap) *before* touching the
  filesystem, and verify the result after each write/delete to confirm
  it actually happened, not just that `fs` didn't throw.
- `update` writes a `.bak` copy of the previous version before
  overwriting, and a failed backup doesn't block the update — it's a
  best-effort safety net, not a hard requirement.
- Top-level `process.on('uncaughtException', …)` and
  `process.on('unhandledRejection', …)` handlers catch anything that
  slips past the inner try/catch blocks and exit with a clear message
  instead of a raw stack dump.

## Security considerations

- **CRUD is sandboxed.** All file operations resolve inside
  `./collected_files` next to the script. Filenames are validated
  against `^[a-zA-Z0-9._-]+$` and explicitly rejected if they contain
  `..`, `/`, or `\`, so this tool cannot read, write, or delete
  anything elsewhere on the filesystem — it's a file manager, not a
  shell.
- **Environment variables are allowlisted by default.** `--env` only
  ever returns 7 known-safe variables. The full `process.env` is only
  exposed via the explicitly separate `--env-all` command, and even
  then, any key matching `/key|secret|token|password|pwd|credential|
  auth|cert|private/i` has its value masked (first/last 2 characters
  kept, the rest replaced with asterisks) before being printed or
  serialized.
- **No shell injection surface.** The only `execSync` calls run fixed
  strings (`npm -v`, `python --version`) — no user input is ever
  concatenated into a shell command.

## Why this is JS, not a JS "virus"

The brief asks for a diagnostic/inventory tool: read local system
metadata and manage files in a project-local folder. There's no
self-replication, no network exfiltration, no execution of remote
code, and no operation outside the sandboxed directory — by design,
not by accident. That's reflected directly in the validation layer
above.

## Possible next steps (not implemented, scoped out deliberately)

- Disk usage / network interface reporting (`os.networkInterfaces()`)
  would be straightforward to add as another section, but was left out
  to keep the env-var surface area small and the tool focused on what
  was asked.
- A `--watch` mode for live-updating memory/CPU stats was considered
  but adds complexity (interval cleanup, terminal redraw) disproportionate
  to the brief.