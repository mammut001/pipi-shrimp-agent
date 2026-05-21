# Windows terminal profiles

On Windows, local tool calls and embedded terminals should default to **PowerShell**, not WSL.

## Recommended defaults

- Use **PowerShell** for Windows workspaces and native Windows paths such as `C:\...` or `D:\...`.
- Use **PowerShell** for `npm ci`, `npm run build`, `npm run tauri:build`, `cargo check`, `cargo build`, and `cargo-tauri build`.
- Use **WSL** only when the workspace is already inside WSL/Linux, the user explicitly selects WSL, or the command requires a Unix shell.

## Bash-only workflows

Some scripts in this repo are intentionally bash-only, for example:

- `npm run smoke:autoresearch:local`
- `npm run test:browser-gate`

If you need to run those on Windows, switch the shell profile to **WSL** or use Git Bash.

## Avoid mixed artifacts

Do not mix PowerShell and WSL installs or build outputs in the same checkout.

Avoid patterns like:

- running `npm install` in PowerShell and then running `npm install` again in WSL in the same repo
- building `src-tauri/target` from both PowerShell and WSL in the same checkout

Mixing shells can corrupt or confuse `node_modules`, lockfiles, Cargo target directories, native dependencies, file permissions, and paths.
