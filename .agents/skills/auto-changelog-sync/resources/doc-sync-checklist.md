# Documentation Sync Checklist

Use this mapping matrix after every code or configuration change to decide which project files must be updated alongside `CHANGELOG.md`.

## Change-to-Documentation Mapping

| Type of Code Change                            | Must Update `CHANGELOG.md`                       | Other Files to Sync                                                             |
| ---------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| New feature / module / CLI command             | `### Added`                                      | `README.md` (Features & Usage sections)                                         |
| New or renamed `process.env.*` / `os.getenv()` | `### Added` or `### Changed`                     | `.env.example`, `README.md` (Environment Variables table), `docker-compose.yml` |
| New or modified API endpoint / payload         | `### Added` or `### Changed`                     | `docs/api.md`, `openapi.yaml` / `swagger.json`                                  |
| Smart contract ABI / address / network change  | `### Changed`                                    | `README.md`, contract deployment docs, frontend config examples                 |
| Database schema / migration change             | `### Changed`                                    | `README.md` (Setup / Migration steps), `docs/schema.md`                         |
| Bug fix / error handling improvement           | `### Fixed`                                      | Troubleshooting section in `README.md` (if user-facing)                         |
| Security patch / auth hardening                | `### Security`                                   | Security or Auth notes in `README.md` / `docs/`                                 |
| Formal version release (`vX.Y.Z`)              | Promote `[Unreleased]` to `[X.Y.Z] - YYYY-MM-DD` | `package.json`, `pyproject.toml`, `Cargo.toml`, or `VERSION`                    |

## Pre-Completion Verification Checklist

- [ ] `CHANGELOG.md` exists and has an `## [Unreleased]` section at the top.
- [ ] Every bullet starts with a bold component tag (`- **[Component]**:`).
- [ ] Empty category headings (`### Deprecated`, `### Removed`, etc.) are omitted from released version blocks.
- [ ] Every new environment variable in the codebase has a safe placeholder in `.env.example`.
- [ ] No real secrets, API keys, or private keys were written into `.env.example`, `README.md`, or `CHANGELOG.md`.
