# Pigpen release blockers

**Publication is intentionally blocked, not implemented by a site workaround.**
Pigpen CI **validates and smoke-tests; it does not release**: it checks the generated index, source quality gates, unit tests,
and validates every Package and staged manifest, and runs the porter, tool-scope, moved-extension and Go
module tests, all with a pig built from PiG `v0.4.0`. A platform matrix then builds all ten Piglets natively on
`linux/amd64`, `linux/arm64`, `darwin/arm64`, `darwin/amd64` and `windows/amd64` with the pinned PiG release (checksum verified) and
smokes every Binary (`--version` and one `PIG_TEST_FAUX` turn, no extension load error); `android/arm64` is compiled and vetted.
Binaries are kept as three-day artifacts. It does not sign Binaries, handle signing keys, or publish. A `<name>/v<release.version>` tag is recognized, then refused by the
release guard (`scripts/build-matrix.mjs`). The workflow has no signing secrets or write permissions.
No release gate has been waived. No hosted CI run is claimed: every step below was run locally with the
same pig, and the matrix's linux/amd64 job and the android check were run locally the way the workflow runs them. The first run of the
other four platforms is a manual `workflow_dispatch` on the pull request branch.

This file says what still stands between the repository and a first release, and who has to act.
Evidence was gathered with PiG 0.4.0 (`0.4.0+1.0.0`, tag `v0.4.0`, commit
`76022638c15e2f68f1cee9c6b8984eee1baba620`), Go 1.27.1, Node 24.19.0, linux/amd64.

## What PiG 0.4.0 settled

| Earlier blocker | State on PiG 0.4.0 | Evidence |
|---|---|---|
| A public, reviewed PiG revision with per-Piglet tags, namespace-aware update and subdirectory add | **Resolved.** `v0.4.0` is public; CI pins its commit; `npm run test:porter` is enabled in CI | `pig piglet publish --tag-prefix <name>/`; the prefix must equal the manifest name plus `/` (`--tag-prefix a2a/` for the herdr Piglet is refused). `pig docs show piglets`, "Monorepo publication and named Binary updates" |
| Print and JSON mode ignored a per-extension `tools: []` | **Resolved.** | `npm run test:tool-scope`: RPC, print and JSON mode pass, with a control case that offers `pig_doctor` without the scope |
| No Go `pi.events` bridge | **Resolved in the SDK** (`Extension.Events()`). Pigpen's herdr reporter does not use it yet (see below) | PiG `extensions/sdk/event_bus.go` |
| Go SDK pin older than the herdr extension needs | **Resolved.** Every module requires the published `sdk v0.4.0` | `go.sum` is committed; a module with no library dependency vets with plain `go vet` (`GOWORK=off`) |
| Publisher receipts for the catalog | **Answered**: PiG emits one (below) | a real `piglet-release.json` captured from `pig piglet publish --yes` (with a stub `gh`) |
| Node extension in a Piglet Binary | Not re-checked. No Pigpen Piglet selects a Node extension (owner rule: Go only) | The PiG defect is untouched |

Newer than the target: tool renderers (`pi.registerToolRenderer`, `Extension.ToolRenderer`, D89) are in
the PiG 0.4.1 content, not in `v0.4.0`. The 0.4.0 SDK lacks them, so a port that needs them is blocked
on this pin (`pigeq gaps` says so), and the fake-host tests for them (a build tag the scripts set only for an SDK that has them) are not compiled against `v0.4.0`.

## Local evidence on PiG 0.4.0

Run with a temporary HOME, PIG_HOME and agent directory, `PIG_BIN` the `0.4.0+1.0.0` release build:

- `npm test` (156), `npm run check`, `npm run validate` (17 Go extension directories pass
  `pig install <dir> --validate-only`; every Package passes `pig package validate`; every staged Piglet passes
  `pig piglet validate`), `test:porter` 2/2, `test:tool-scope` 4/4, `test:moved` 1/1, `test:go-ports` (every Go module
  vetted and tested; the 11 ACP end-to-end scenarios run, none skipped), `test:go`, `test:acp-interop` (30 messages
  checked against schema 0.26.0), `test:pig` 4/4, `test:pig-snake` 9/9, `test:doctor-mutations`.
- `npm run build:piglet` builds all 10 Piglets on linux/amd64; each Binary reports `0.4.0+1.0.0`, starts in RPC mode
  and lists its commands. `go vet` for linux/arm64, darwin/arm64, darwin/amd64 and windows/amd64 is clean for all 23
  modules (a type-check, not a run; PiG's native builder builds only its host target).
- Publish, dry run, all 10 Piglets (stub `gh`, throwaway key, host target): tag `<name>/v0.1.0`, `pull github:<owner>/<repo>/<name>@0.1.0`.
  A full `publish --yes` with `--artifacts` against the stub produced a signed `piglet-release.json` and `SHA256SUMS`.

## What still blocks a first release

### Pigpen has to decide or do

1. **Source-add form. Recommendation: Binary-only first release; no remote source add.** Re-checked on 0.4.0 with local
   fixtures (git `url.<file>.insteadOf`, no network):
   - An authored Piglet cannot be added from source: `piglets/herdr` fails with `Piglet closure path must be a portable
     relative path` (it selects `../../components/herdr`).
   - A committed staged tree adds (`dist/staged` committed in a repository: `herdr`, `pig-with-batteries` added), but
     `dist/` is not committed, and publishing a generated tree is a second source of truth.
   - `pig-porter` (uses `extends`) cannot be added even from a staged tree (`Piglet add cannot copy an extends dependency
     closure`).
   Binaries do not depend on any of this: `pig piglet pull github:<owner>/pigpen/<name>@<version>` installs the signed
   Binary. If the owner wants source add later, either commit a generated tree on a release branch or move compositions to
   `npm:`/`git:` Package references (the latter needs a Package published from its own repository or tag).
2. **The protected release workflow.** A reviewed draft is in
   [`docs/plan/release-workflow.draft.yml`](docs/plan/release-workflow.draft.yml). It is not under `.github/workflows` and has never
   run on GitHub: it needs the owner actions below. Until it is adopted and run on a throwaway repository, the release guard
   in `scripts/build-matrix.mjs` stays; remove the guard only together with the workflow.
3. **Index generation from receipts.** PiG's receipt is the signed `piglet-release.json` (DSSE envelope, payload type
   `application/vnd.pig.piglet-release+json`). Payload fields: `piglet`, `version`, `pigVersion`, `sourceRef`,
   `github.repository`, `github.tagPrefix`, `signer.keyId`, `signer.publicKey` and, per target, `binaries["<os>/<arch>"]`
   with `url`, `sha256`, `size`. `scripts/generate-index.mjs` still emits only `planned` entries, because `index.schema.json`
   fixes `status: planned` and the website consumes that schema. Producing `available` entries means: verify the Ed25519
   signature against a public key pinned in this repository (never trust the payload's own key), require tag, name and
   version equality, and change the schema together with the website. That needs a real release to take the receipt from and
   an owner decision on the site contract, so it is not done here.
4. **herdr `herdr:blocked`.** The SDK bridge exists; the reporter does not listen yet and two named tests stay skipped
   (`components/herdr/extensions/herdr/extension_test.go`). Not a release blocker; a Pigpen follow-up (the herdr fake host needs the
   bus wire frames).
5. **a2a third-party Go modules** (`a2a-go/v2` v2.6.0 and four transitive modules) are fetched from the Go proxy at build
   time. Decide: vendor them (licenses then travel with the Package) or accept the proxy for release builds. Also report
   upstream: a2a-go v2.6.0 `SubscribeToTask` on a live task does not check task ownership (Pigpen guards it in its call
   interceptor).
6. **Shared library Packages** (`pig-play`, `typesafe`, `pi-typesafe-api`) reach a Piglet through a `go.work` in the extension
   directory, and a staged Package's alias must equal its directory name. This works (the Binaries above were built that way),
   but it is an implicit contract. PiG could document a `replace` or a `packages/`-relative reference.
7. **Piglet composition limits** (`extends`; PiG items, input for PiG): `pig piglet add` refuses an `extends` closure
   (re-checked on 0.4.0); `extends.source` accepts only `local:` and contributed schemes; `extends` with `agentEnv` is not
   implemented; `release` and `build` are not inherited, so a derived Piglet repeats `build.targets`. A Go extension directory
   with both a factory and a `package main` is rejected, so a command line shares code through a module of its own
   (`cmd/pigeq/go.mod`). Not re-checked on 0.4.0 beyond the add refusal.
8. **Curation and licenses.** Finish curation, keep every source pinned, review the dependency closure and licenses of each
   Piglet (the Package READMEs and `provenance.json` hold what is known).
9. **A real end-to-end publication** on a throwaway repository (needs the owner's actions below): two Piglets with the same version,
   pulled and updated independently, escaped slash tags (`%2F`), a mismatched name or prefix, an existing release, tampered
   bytes, a signer change. PiG's own tests cover the same cases against a local TLS server, not GitHub; the dry runs and the stub
   `gh` publish above exercise only Pigpen's side.
10. **Targets without a native host here.** CI now builds and smokes every Piglet on native runners for all five targets
    (`platform-matrix` in `ci.yml`), but nothing has run on darwin, windows or linux/arm64 yet: the first hosted run
    (`workflow_dispatch`) is the first evidence. The smoke proves a Binary starts and completes a faux turn there, not that the
    games render or the terminal integrations work (see "What still has to be run" in `RELEASE-NOTES.md`). `android/arm64` is a
    compile and vet check only: PiG's native builder cannot build a fused android Binary from another OS.

### Owner actions (who must act)

| Who | Action | Why |
|---|---|---|
| Repository owner | Create Ed25519 signing keys with `pig piglet keygen` (one per Piglet, or one key for all, an owner decision); keep the private keys out of the repository and this host | `pig piglet publish` signs every Binary and the index |
| Repository owner | Create the GitHub environments the workflow names (`piglet-<name>`), add `PIGLET_SIGNING_KEY` as an environment secret, require a reviewer, and limit each environment's deployments to its tags (`<name>/v*`). Never add `PIGLET_SIGNING_KEY` as a repository or organization secret: a job that names a missing environment gets a new, unprotected one and would read such a secret | the draft's protected, per-Piglet signing |
| Repository owner | Add a tag protection (ruleset) for `*/v*` so only maintainers can create release tags | a tag starts a signing run |
| Repository owner | Allow Actions to create releases and use attestations (Settings, Actions, Workflow permissions; a public repository for attestations) | `gh release create` and `actions/attest-build-provenance` |
| Repository owner | Publish the public keys (`.pub`) in the repository (a `release-keys/` directory) and in the README, and pin them in `generate-index.mjs` | users run `pig piglet trust add`; the index generator verifies against them |
| Repository owner | Create a throwaway repository and a `gh` login (or a token with release rights) for the end-to-end run (item 9) | no real publication was or could be run here |
| Repository owner | Decide item 1 (Binary-only first release) and the index/site contract (item 3) | both change what the site shows |
| npm organization owner | **Nothing is needed for a Binary-only release.** An npm scope and organization are needed only if Packages are to be installed as `npm:` references | Packages install from a checkout or `git:` today |
| PiG maintainers | Items 6 and 7 are inputs for PiG; none blocks a Binary-only release | |

Until these are done, do not claim live binaries or verified publication support for Pigpen compositions. Local source
validation and a working core publisher alone do not establish an installable Pigpen release.

## ACP (`piglets/acp`, `components/acp`)

Evidence (2026-09-30, PiG 0.3.0 `63c6ba456`; re-run on PiG 0.4.0: the Binary builds, the 11 end-to-end scenarios and the 30-message reference client run pass): the `acp` Piglet **builds a fused Go Binary** (57.6 MB, 44 s) and that Binary passes
the 11 end-to-end scenarios and the ACP reference client run when it is the `--pig` target of the companion executable
`pig-acp`. What is still open:

- **No one-command Binary.** ACP is JSON-RPC on the agent's own stdio, and a fused extension must not write protocol bytes to the
  host's stdout, so the Piglet Binary cannot be an ACP server. The editor runs `pig-acp --pig <Binary>`. Publishing needs the
  companion built per target and shipped with an explicit executable closure (Package and Binary versions that agree), or PiG
  support for it: a `--mode acp` in a Piglet Binary, or a Binary that carries a companion executable. This is an input for a PiG after 0.4.0 (its `--mode` is text, json or rpc).
- **Release workflow:** `scripts/build-matrix.mjs` builds Piglet Binaries only. It has no step that builds and attaches
  `pig-acp` (Go, no cgo, all targets cross-compile: `go vet` passes for linux, darwin and windows; only linux was run).
- **Editors:** Zed and JetBrains were not run (no editor available here). The ACP reference client is the interop evidence.
  A real editor session, including the terminal-login banner, is still to be verified before promising editor support.
- `pig-with-batteries` does not select the Package. That is no longer a build limit (batteries builds a Binary since the Go
  herdr port); adding `acp: local:../../components/acp` (and the `acp` extension entry, `tools: []`) is a two-line change
  that needs an owner decision and its own Binary proof; the fused build of the extension itself is proven.

## Open items from the warden port (`components/warden/port/PORT.md`)

- **Go SDK, still in `v0.4.0`** (re-checked by running the skipped test against it): `Context.GetBranch` drops an assistant message whose tool-call block carries `arguments`
  as a JSON object (Pi writes an object; the SDK reads a string), so the plan and sibling calls are lost and the
  intent-mismatch check is never asked. Reproduction: `components/warden/port/sdk-args_test.go.txt`. Skipped
  test: `TestSkippedSDKToolCallArgumentsAsObject`.
- **pigeq gaps found by the warden port**: `mutate --unit` cannot run a port that uses a shared
  library module (its temporary `go.work` lacks `components/typesafe`); the host check with `--builtin` also loads the port into the
  original's lane. PiG re-serializes tool-call arguments with HTML escaping (`>` as `\u003e`), unlike Pi (host difference,
  `port/PORT.md` finding 4).
- **Owner decisions**: which of the deferred pi-warden guards (rules file, slop, secret masking, context saver,
  conscience, subagent supervision, path and arming rules, SQL target classification, stuck evidence) to port next.
- **Two SDK generations**: the host getters return `(value, error)` from the PiG 0.3.0 pre-release builds on (and in
  `v0.4.0`) and a single value on older `pig` builds. Warden targets the former; a Piglet Binary builds against the SDK of `PIG_SOURCE_ROOT`.
