# Reference Examples for Auto Changelog Sync

## Example 1: Post-Task Incremental Update (Indonesian Repository)

**Scenario**: The agent added a receipt validation endpoint, introduced a `MAX_UPLOAD_MB` environment variable, and fixed a timeout bug on image uploads.

### Updated `CHANGELOG.md`

```markdown
## [Unreleased]

### Added

- **[API]**: Menambahkan endpoint `POST /api/receipts/validate` untuk verifikasi struk pembayaran otomatis.
- **[Config]**: Menambahkan variabel `MAX_UPLOAD_MB` pada `.env.example` untuk membatasi ukuran unggahan gambar.

### Fixed

- **[Uploader]**: Memperbaiki masalah _timeout_ saat mengunggah foto beresolusi tinggi pada koneksi lambat.
```

### Updated `.env.example`

```dotenv
# Batas maksimum ukuran file struk dalam MB (Default: 5)
MAX_UPLOAD_MB=5
```

---

## Example 2: Consolidating Multiple Git Commits into a Release (English Repository)

**Raw Commits from `scripts/changelog-sync.js range v1.1.0 v1.2.0`**:

- `a1b2c3d`: `feat(auth): add wallet signature verification (#41)`
- `b2c3d4e`: `fix(auth): handle EIP-191 prefix mismatch in signature check (#43)`
- `c3d4e5f`: `chore: run prettier across src/`
- `d4e5f6a`: `fix(rpc): retry failed BNB Chain RPC calls with exponential backoff (#45)`

### Resulting `CHANGELOG.md` Release Entry

The two related `auth` commits are consolidated into a single bullet point, while the formatting commit (`c3d4e5f`) is skipped as noise:

```markdown
## [Unreleased]

## [1.2.0] - 2026-11-16

### Added

- **[Auth]**: Implemented Web3 wallet authentication with EIP-191 signature verification ([#41](https://github.com/owner/repo/pull/41), [#43](https://github.com/owner/repo/pull/43)).

### Fixed

- **[RPC]**: Added exponential backoff retry logic for failed BNB Smart Chain RPC requests ([#45](https://github.com/owner/repo/pull/45)).
```
