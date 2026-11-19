---
name: auto-changelog-sync
description: Automatically update CHANGELOG.md and related project documentation (README.md, .env.example, API docs, version files) whenever code, features, bug fixes, or configurations are modified. Use this skill proactively after making any codebase changes, implementing features, fixing bugs, refactoring, or when the user asks to update the changelog, release notes, or project docs.
---

# Auto Changelog and Documentation Sync

Ensure every meaningful code, feature, bug fix, or configuration change is accompanied by an accurate update to `CHANGELOG.md` and any affected project documentation before concluding a task.

## Supporting Skill Files

- `scripts/changelog-sync.js`: Helper script to inspect Git working tree changes, extract commit histories between tags, and detect undocumented environment variables.
- `examples/changelog-examples.md`: Reference examples for single-task updates, multi-commit consolidation, and version releases.
- `resources/CHANGELOG-template.md`: Standard Keep a Changelog starter template when initializing a new file.
- `resources/doc-sync-checklist.md`: Mapping matrix and verification checklist for syncing `README.md`, `.env.example`, API specs, and manifest versions.

## When to Use

- After implementing a new feature, API endpoint, UI component, smart contract, database migration, or CLI command.
- After fixing a bug, regression, performance bottleneck, or security vulnerability.
- After modifying environment variables, configuration schemas, dependencies, or breaking behaviors.
- When the user explicitly asks to update the changelog, cut a release, or sync project documentation.

## Workflows

### 1. Mandatory Post-Change Sync (After Code or Config Edits)

Whenever you modify files in the codebase, run through this workflow before finishing your response:

1. **Inspect Changes & Audit Environment Variables**:
   - Run the helper script to get a JSON summary of modified files and undocumented environment variables:
     ```bash
     node .agents/skills/auto-changelog-sync/scripts/changelog-sync.js status
     ```
   - Fallback if Node.js is unavailable: run `git status --short` and `git diff`.

2. **Update `CHANGELOG.md`**:
   - Locate `CHANGELOG.md` in the project root. If it does not exist, create it using `resources/CHANGELOG-template.md`.
   - Add new entries under `## [Unreleased]` at the top of the file.
   - Categorize changes under the appropriate subheadings:
     - `### Added` for new features, endpoints, or capabilities.
     - `### Changed` for updates to existing functionality, behavioral refactors, or dependency upgrades.
     - `### Deprecated` for features scheduled for removal.
     - `### Removed` for deleted features, endpoints, or configurations.
     - `### Fixed` for bug fixes and error-handling improvements.
     - `### Security` for vulnerability patches, authentication hardening, or permission fixes.

3. **Sync Related Documentation and Configs**:
   - Consult `resources/doc-sync-checklist.md` and update affected files in the same pass:
     - **`README.md`**: Update setup instructions, CLI flags, feature lists, or usage examples.
     - **`.env.example` / Config Templates**: Add any `missingInEnvExample` keys reported by the script using safe placeholder values and brief comments.
     - **API / Contract Docs (`docs/*.md`, `openapi.yaml`)**: Update routes, request/response schemas, or smart contract addresses/ABIs when interfaces change.

4. **Verify Before Finishing**:
   - Ensure `CHANGELOG.md` is valid Markdown, contains no duplicate entries, and matches the repository's existing language (Indonesian or English).
   - Briefly mention the updated documentation files in your final response.

### 2. Generating a Version Release from Git History

When the user asks to release a specific version or generate a changelog between Git tags (e.g., "Release v1.4.0" or "Buat changelog dari v1.2.0 ke v1.3.0"):

1. **Fetch Commit Data**:
   - Run the helper script to extract commits between the base tag and head ref as JSON:
     ```bash
     node .agents/skills/auto-changelog-sync/scripts/changelog-sync.js range <base_ref> <head_ref>
     ```

2. **Categorize and Consolidate**:
   - Read the full commit subject and body from the JSON output.
   - Consolidate multiple commits belonging to the same feature or bug fix into a single bullet point (see `examples/changelog-examples.md`).

3. **Promote `[Unreleased]` & Sync Version**:
   - Move items under `## [Unreleased]` into a new version heading `## [X.Y.Z] - YYYY-MM-DD` and leave an empty `## [Unreleased]` section at the top.
   - Update version numbers in `package.json`, `pyproject.toml`, `Cargo.toml`, or `VERSION` only when explicitly cutting a release.

## Summarization and Writing Guidelines

- **Focus on impact, not file diffs**: Rewrite technical edits into a clear, 1-sentence bullet point explaining the impact for the user or developer.
  - _Good_: `- **[Auth]**: Added JWT refresh token rotation to prevent unexpected session logouts.`
  - _Bad_: `- Updated authController.ts and added helper function in tokenUtils.ts.`
- **Prefix with component name**: Start each bullet with the affected module in bold (e.g., `- **[API]**:`, `- **[UI]**:`, `- **[Database]**:`, `- **[SmartContract]**:`).
- **Include Issue/PR/Commit Links**: Link PRs (`([#123](url))`) or short commit hashes (`([a1b2c3d](url))`) when available in the JSON output.
- **Skip noise**: Ignore formatting-only commits, typo fixes in comments, or edits to `CHANGELOG.md` itself.
- **Code Block Output**: When the user asks to display the generated changelog in chat, wrap the output in a ````markdown` code block for direct copy-pasting.

## Gotchas

- **Undocumented environment variables**: Never introduce `process.env.*`, `import.meta.env.*`, or `os.getenv()` in code without adding the key to `.env.example`.
- **Overwriting historical releases**: Never alter or delete past `## [X.Y.Z]` sections in `CHANGELOG.md`.
- **Bumping versions unprompted**: Do not increment `package.json` version numbers on routine code edits unless the user explicitly asks for a release.
