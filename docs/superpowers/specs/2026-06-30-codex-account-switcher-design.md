# Codex Desktop Account Switcher Design

## Goal

Provide a Windows PowerShell utility that switches between two user-owned
ChatGPT Plus accounts in Codex Desktop while preserving one shared Codex home
directory, including local threads, project history, configuration, and
plugins.

The utility only switches locally cached credentials. It does not automate
OpenAI login, create accounts, bypass usage controls, or expose access tokens.

## Scope

The utility supports three commands:

- `register A` or `register B`: save the currently active `auth.json` into the
  selected account slot.
- `switch A` or `switch B`: preserve the active slot's refreshed credentials,
  replace `auth.json` with the selected slot, and update a non-secret marker.
- `status`: show the active slot and whether both slots are registered without
  printing credential contents.

Both accounts use the existing `%USERPROFILE%\.codex` directory. Only
`auth.json` changes, so local sessions and configuration remain shared.

## Storage

Credential slots are stored under `%USERPROFILE%\.codex\account-switcher`:

- `auth.account-a.json`
- `auth.account-b.json`
- `active-account.txt`

The script and its tests live in the repository. Credential files remain
outside the repository and must never be committed.

File-based credential storage is required. The existing Codex configuration
and presence of `%USERPROFILE%\.codex\auth.json` are checked before any
registration or switch.

## Switching Flow

1. Validate the requested command and slot.
2. Refuse mutation if any Codex Desktop process is running.
3. Validate that the current `auth.json` and target slot contain valid JSON.
4. On registration, copy the current credentials atomically into the selected
   slot and mark that slot active.
5. On switching:
   - If an active slot is recorded, atomically save the current `auth.json`
     back into that slot so refreshed tokens are retained.
   - Copy the target slot to a temporary file.
   - Validate the temporary JSON.
   - Atomically replace `auth.json`.
   - Update the active-slot marker.
6. Print only the selected slot and the instruction to reopen Codex Desktop.

## Safety and Error Handling

- Never display, parse for presentation, or log token values.
- Refuse to overwrite an already registered slot unless `-Force` is supplied.
- Refuse switching while Codex processes are active.
- Use temporary files and atomic replacement to avoid a partially written
  `auth.json`.
- Preserve a timestamped backup before replacing the active credentials.
- Restrict slot and backup files to the current Windows user where supported.
- Stop without changing the active credentials if validation fails.
- Cloud tasks, connectors, and workspace-owned resources remain account-bound;
  only local thread visibility is shared.

## Testing

Automated tests use a temporary fake Codex home and synthetic JSON credentials.
They cover:

- registering both slots;
- rejecting duplicate registration without `-Force`;
- switching in both directions;
- saving refreshed credentials back to the previous slot;
- rejecting missing and malformed credential files;
- refusing mutation when a simulated Codex process check reports active;
- ensuring status output does not contain synthetic token values.

No test reads or modifies the real `%USERPROFILE%\.codex\auth.json`.

## Installation and Initial Use

After tests pass, the script may be copied to a user-selected local tools
directory or run directly from the repository.

Initial setup:

1. Completely exit Codex Desktop while account A is signed in.
2. Run `register A`.
3. Open Codex, sign out, and sign in as account B.
4. Completely exit Codex and run `register B`.
5. Thereafter, exit Codex and run `switch A` or `switch B` before reopening it.

