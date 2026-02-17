# Secure Vault Implementation

This document describes the Secure Folder/Vault feature: data model, crypto, IPC, storage layout, UX flows, and operational caveats.

## Goals

- Encrypt videos at rest and keep them out of the normal library.
- Keep files hidden in app data with opaque filenames.
- Require a password to unlock; allow password reset that wipes secure content.
- Minimize UI visibility (small entry point) while keeping UX consistent.

## Storage Layout

All secure content lives in Electron `app.getPath('userData')`:

- Vault storage: `~/.config/kino/secure-vault/`
  - Encrypted blobs with random names like `ab12...ef.bin`
- Thumbnails (unchanged): `~/.config/kino/thumbnails/`
- DB: `~/.config/kino/kino.db`
- Log: `~/.config/kino/kino-debug.log`
- Playback temp cache: `app.getPath('temp')/kino-secure-cache/`

The vault never stores plaintext files at rest.

## Database Schema

Added table:

```sql
CREATE TABLE IF NOT EXISTS secure_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  plot TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  rating REAL,
  original_name TEXT NOT NULL,
  encrypted_path TEXT UNIQUE NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

The original source path is not kept; only the original filename (`original_name`) is stored.

## Cryptography

### Overview

- AES-256-GCM for authenticated encryption.
- Key derived from password using `scrypt`.
- Separate salts for authentication vs. encryption.

### Password Storage

Settings keys (in `settings` table):

- `secure_auth_salt` (base64)
- `secure_auth_hash` (base64; derived via `scrypt`)
- `secure_key_salt` (base64; used to derive encryption key)

### File Format

Each encrypted file is a simple binary container:

- Header: `MAGIC` + `VERSION` + `IV`
  - `MAGIC`: `KINOSEC1`
  - `VERSION`: `1` (1 byte)
  - `IV`: 12 bytes (GCM)
- Ciphertext: encrypted bytes
- Auth tag: 16 bytes appended at end

On decrypt:
1. Read header, validate magic + version
2. Read auth tag from file tail
3. Stream decrypt content

## Core Flows

### 1) Set Password (First Use)

Triggered from Secure Folder page or first “Move to Secure”.

- Generate `authSalt` + `keySalt`.
- `authHash = scrypt(password, authSalt, 32)`
- Store salts + hash in settings.
- `unlockedKey = scrypt(password, keySalt, 32)`
- Ensure vault + cache directories exist.

### 2) Unlock

- `authHash` recomputed with `authSalt` and compared with stored hash using `timingSafeEqual`.
- If valid, derive `unlockedKey` using `keySalt`.

### 3) Lock

- `unlockedKey = null`
- Delete any cached decrypted playback files.

### 4) Reset (Forgot Password)

Destructive by design:

- Lock vault
- Delete all `secure_items` rows
- Clear auth settings
- Remove `secure-vault` and `kino-secure-cache` directories

### 5) Import Movie to Secure

Path: `secure:import-movie` (already unlocked) or `secure:import-movie-with-password` (auto-unlock).

Steps:

1. Encrypt original file into `secure-vault/<random>.bin`.
2. Create `secure_items` row with metadata and encrypted path.
3. Delete original file.
4. Remove item from `movies` table (library).

If any step fails, the encrypted blob and DB row are removed for cleanup.

### 6) Secure Playback

Current implementation decrypts to a temporary file:

1. `secure:prepare-playback` decrypts item into `kino-secure-cache/<id>-<timestamp>.<ext>`.
2. The UI sets `movie.file_path` to that temp file and uses the existing `media://` protocol.
3. On player close or vault lock: `secure:release-playback` deletes the temp file.

This means plaintext exists **only while playing**.

## IPC Surface

Registered in `electron/lib/ipc.ts`:

- `secure:status` -> `{ hasPassword, isUnlocked }`
- `secure:set-password`
- `secure:unlock`
- `secure:lock`
- `secure:reset`
- `secure:list`
- `secure:import-movie`
- `secure:import-movie-with-password`
- `secure:prepare-playback`
- `secure:release-playback`
- `secure:delete-item`

## UI/UX

### Entry Point

- Hidden in the sidebar footer: a small lock icon.
- Route: `/secure`

### Secure Folder Page

States:

- First time: “Create Secure Password”
- Locked: “Unlock Secure Folder”
- Unlocked: grid of secure items and play/delete actions

Auto-lock behavior:

- When leaving the Secure Folder page, the vault locks automatically.
- Any decrypted temp playback file is removed.

### Move to Secure

From `MovieCard` hover:

- Always opens a modal.
- If unlocked: confirm “Move to Secure Folder”.
- If locked and has password: prompt for password.
- If no password: prompt for password + confirmation to set up vault.

## Security & Privacy Notes

- Files are encrypted at rest with authenticated encryption (AES-GCM).
- Unlocking does **not** decrypt files on disk.
- Playback does decrypt to a temporary plaintext file; it is deleted on close/lock.
  - If you need zero plaintext on disk, this should be replaced by streaming decryption.

## Relevant Files

- `electron/lib/secure.ts` — encryption, password, vault ops
- `electron/lib/ipc.ts` — IPC handlers
- `electron/lib/database.ts` — secure_items + settings helpers
- `src/pages/SecureFolder.tsx` — secure page UI + auto-lock
- `src/components/MovieCard.tsx` — “Move to Secure” modal + flow

## Future Improvements

- Stream-decrypt playback (no temp file).
- “Restore to Library” action to export decrypted file to a chosen folder.
- Password strength meter and visibility toggle.
- Optional idle timeout auto-lock.
