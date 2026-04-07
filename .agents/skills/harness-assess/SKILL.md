---
name: harness-assess
description: Assess any coding agent harness codebase against the Harness Taxonomy framework. Produces a filled taxonomy matrix and an architecture map linking each concept to source code locations. Use when the user asks to assess, analyze, map, or evaluate a harness repo, agent tool, meta-harness, orchestrator, or agentic runtime. Also use when user mentions taxonomy matrix, harness taxonomy, architecture map, or wants to understand how a coding agent tool is built. Trigger even if the user just says "assess this repo" or "fill the matrix" while in a cloned harness repository.
---

# Harness Assessment

Systematically explore a coding agent harness codebase and produce:

1. A filled **taxonomy matrix** — every concept assessed with option letter + confidence
2. An **architecture map** — each concept linked to specific files, directories, and line ranges

## Skill reference files

- [search-patterns.md](./references/search-patterns.md) — per-module grep strategies
- [subagent-prompts.md](./references/subagent-prompts.md) — the 7 subagent task templates
- [recon.sh](./scripts/recon.sh) — quick reconnaissance script
- [harness-taxonomy.md](./harness-taxonomy.md) — the full taxonomy framework

## Quick start

When triggered, immediately:

1. Run the recon script: `bash scripts/recon.sh <repo-path>` (relative to this skill's directory)
2. Read the recon output to understand the repo shape
3. Read [harness-taxonomy.md](./harness-taxonomy.md) to load the full taxonomy
4. Begin the phased exploration workflow below

## Workflow

### Phase 1 — Reconnaissance (do this yourself, no subagents)

Run [recon.sh](./scripts/recon.sh) against the repo root and review its output. Then manually:

- Read README.md (first 200 lines)
- Read package.json / Cargo.toml / go.mod / pyproject.toml (dependencies reveal architecture)
- Read the directory tree (2 levels)
- Identify: language, runtime, entry point files, config file locations
- **Determine H.1 (Harness type)** — this gates everything else

### Phase 2 — Targeted exploration via subagents

Read [search-patterns.md](./references/search-patterns.md) for per-module search strategies.

Spawn **7 subagents**, one per module cluster (M0–M15, 16 modules total). Each subagent gets:

- The cluster's taxonomy concepts (from [harness-taxonomy.md](./harness-taxonomy.md))
- The cluster's search patterns (from [search-patterns.md](./references/search-patterns.md))
- The repo path and the recon summary from Phase 1

Read [subagent-prompts.md](./references/subagent-prompts.md) for the 7 task templates.

**Subagent rules:**

- Each subagent must **search before reading** — grep/rg first, then read targeted line ranges
- Each subagent returns: concept letter + confidence (HIGH/MED/LOW) + file:line evidence
- Subagents must NOT read entire files — only targeted ranges around search hits
- If a concept has no evidence after searching, mark it `?` not guess

### Phase 3 — Assembly

Collect all 7 subagent results. Then:

1. Resolve any cross-references (e.g., M5 stall detection may inform M1.6 error routing)
2. Cross-check consistency (e.g., if M0.1 says "pipe spawn" but M1.3 says "tmux capture" — contradiction)
3. Assemble the final matrix and architecture map

### Phase 4 — Output

Write two files to the repo root (or user-specified location):

**`harness-matrix.md`** — The filled taxonomy matrix:

```md
# {Tool Name} — Taxonomy Matrix

| Module | Concept        | Option | Confidence | Evidence                                 |
| ------ | -------------- | ------ | ---------- | ---------------------------------------- |
| M0     | M0.1 Transport | D      | HIGH       | src/spawn.ts:42 — Bun.spawn() with pipes |
```

**`harness-architecture-map.md`** — The architecture map:

```md
# {Tool Name} — Architecture Map

## M0 — Model Interface

### M0.1 Transport: D (Pipe spawn)

- `src/spawn/process.ts:42-87` — spawn logic with stdin/stdout pipes
- `src/spawn/ndjson.ts:1-30` — NDJSON stream parser

### M0.2 Auth: C (Credential inheritance)

- No auth code found — relies on sub-harness stored credentials
```

## Evidence standards

- **HIGH** — Direct code evidence: function definition, config schema, explicit implementation
- **MED** — Indirect evidence: dependency in package.json, pattern in test files, mentions in docs
- **LOW** — Inferred: absence of code suggests default/none, or README claim without code backing
- **?** — Could not determine — no evidence found after exhaustive search

## Key principle

**Grep before you read.** Never open a file to browse. Always search for specific patterns first, then read the 20-line range around each hit. This is the single most important rule for efficient codebase exploration. See [search-patterns.md](./references/search-patterns.md) for the exact queries per concept.
