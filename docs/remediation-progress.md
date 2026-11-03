# Remediation acceptance and remaining rollout

Evidence date: 2026-11-03 (Asia/Shanghai). This record tracks the original eight
implementation phases. Local verification, staged infrastructure and observed
production behavior are separate acceptance levels.

## Phase status

| Phase | Delivered evidence | Remaining acceptance |
| --- | --- | --- |
| 0: stop autonomous merges | The old scheduled proposal workflow is `disabled_manually`; PR #21 removes its merge commands and the publish job's reverse merge. Both trunk rulesets require PRs with no bypass. | The replacement definitions must reach main before scheduling is re-enabled. |
| 1: write safety and package | Single-attempt draft/media writes, bounded safe reads, unknown-outcome errors and malformed-success checks; actual tarball installation/root import/CLI smoke. | Merge application changes through PR #21. |
| 2: source regions and export | Shared code-aware scanner, actual media decoding and containment. Follow-up adds reference-image export, encoded paths, file/clipboard equality, HTML comment regressions and cross-platform uncompressed Windows BMP conversion through bmp-ts and Sharp. | Merge PR #21. Publishing rejects rendered images that were not bound by preparation; use inline Markdown image destinations for publication. Compressed, bitfield and OS/2 BMP encodings are explicitly unsupported. |
| 3: prepare before writes | Resource preparation/final payload validation, cancellation before uploads, all-directory local preflight and unknown-write batch stop. | Merge PR #21. Local preflight does not promise a transaction or an immutable multi-directory snapshot; changed later input is revalidated during execution. |
| 4: cache isolation | Account/normalized endpoint namespaces, purpose-specific keys, fingerprints, atomic per-key entries, single-flight and independent-process regression; legacy data retained. | Merge PR #21. Initial v2 use can upload again. |
| 5: shared reviewed-sync controller | apple-skills PR #95 merged on 2026-11-03. Source head `d0903a289edce06f9b47faa9aaedfb297252efb2`, merge `d3c9042801adf5af8e3b445bb393bdde980c7266`; source fixture and skill-contract checks passed. | Observe its reviewed-sync strategy in an authorized normal cycle. |
| 6: repository integration | Dedicated Mac runner online; private external policy/state; unchanged merged controller staged outside checkout; controller path variable configured. Main/develop PR and two named required checks enforced, no bypass, cleanup retained. Preflight checks deployment digest/permissions/state and delegates only reconciliation. App-backed proposal/reconciliation jobs request revocable repository-scoped tokens. | Existing `rbbtsn0w-bot` App credentials still need provisioning; application changes not on develop/main; lifecycle remains disabled. Bootstrap approval and writer/queue coordination still require the maintainer. |
| 7: regression and normal observation | Application lint/tests/build/package checks and real same-repository PR previews. OIDC identity restored to the existing `release.yml` publisher; npm and GitHub Packages preview observed and the exact CLI installed. | Normal beta publication after integration, bootstrap/stable publication, sync PR human merge, queue validation/reopen, default-branch scheduling and four normal cycles remain unobserved. |

## Live infrastructure inventory

- Repository ID: `1174169063`; default branch: `main`.
- Observed main: `7f12555108388b745990ac1b51476eaafba864fc`.
- Observed develop: `58e241da924068d514b1e9044294aa1e0f3bedda`.
- PR #21 targets develop and remained open during inspection. Refresh both trunk
  tips after its human merge; these values are inspection evidence, not approval.
- Main ruleset `22190802` and develop ruleset `22369896` are active. Required
  checks are `Continuous Integration` and `Validate base branch`, with strict
  up-to-date checks. Required approvals are zero, review resolution is required,
  and bypass actors are empty. Deletion/non-fast-forward restrictions and
  `delete_branch_on_merge=true` remain.
- Runner ID `21`: `wechat-publisher-release-train`, online and idle when inspected,
  labels `self-hosted`, `macOS`, `ARM64`, `release-train-wechat-publisher`.
  Installed runner version `2.338.2` supports the pinned Node 24 App-token action.
- Persistent root: `/Users/snow/Library/Application Support/wechat-publisher-release-train`.
  Policy is `policy.json` (0600); state is `state/` (0700). The initial state has
  zero cycles. No freeze or approval has been created by this acceptance work.
- Deployed controller: `controllers/d0903a289edce06f9b47faa9aaedfb297252efb2/release_train_lifecycle.py`
  below that root, with its source proof in the sibling `source.json`.
  SHA-256: `33a9cc621b6cc455eb7383fa3ef4634c66763e1d2d955050dd79a621905132ea`.
  Bytes were read from the actual shared merge and matched the vendored source.
- Repository variables: `RELEASE_TRAIN_ENABLED=false`, `RELEASE_TRAIN_POLICY_PATH`
  names the external policy, and `RELEASE_TRAIN_CONTROLLER_PATH` names that exact
  deployed version. `RELEASE_TRAIN_APP_CLIENT_ID=Iv23liHFPiEM2pWvzWHH` is configured.
  No Actions secrets were present in the inspection inventory.
- Existing App `rbbtsn0w-bot` (App ID `2758804`) is installed on this repository
  as installation `106926236`, verified from this repository's installed-App page.
  Its public permission declaration includes Contents/Pull requests write and
  Checks/Commit statuses read. Token requests narrow its broader declaration to
  just these permissions and this repository; installation/token success still
  requires the private-key secret and normal workflow evidence.
- Read-only deployment preflight returned `STAGED`, `credential_present=false`,
  `cycle_count=0`. The deployed controller's read-only `status` reached the live
  repository and returned an empty cycle list. This proves read access only.

## Remaining operator handoff, in dependency order

1. Reuse the existing `rbbtsn0w-bot` App: verify its installation on this
   repository, set variable `RELEASE_TRAIN_APP_CLIENT_ID`, and provision secret
   `RELEASE_TRAIN_APP_PRIVATE_KEY` through repository Actions settings, never chat,
   a tracked file or a command argument. Workflows create short-lived tokens scoped
   explicitly to this repository, with automatic revocation when the job ends.
   Needed access is Contents and Pull requests read/write, Checks and Commit
   statuses read, plus Metadata read. No ruleset bypass is needed or permitted.
   Token presence/read success is not a substitute for normal-cycle write proof.
2. Human-maintainer merge of PR #21 into develop, after refreshing its required
   checks and review evidence. Observe the resulting real beta publication and
   its package version; do not create an artificial test release.
3. Prepare a bootstrap promotion PR using live develop/main SHAs. The maintainer
   acknowledges writer freeze and queue-edit freeze independently, then uses the
   deployed, reviewed controller to prepare its checkpoint and record
   `human-required` promotion. Keep the 30-minute lease and exact head/base gate.
   No agent prepares those acknowledgements or merges either trunk.
4. Human merge of the approved promotion into main. Until main contains the new
   lifecycle entrypoint, retain the independent operator command using the same
   absolute controller and persistent policy. Do not run the old scheduled
   workflow or use an unreviewed PR controller to bridge bootstrap.
5. Once main definitions and the credential are verified, enable the lifecycle
   entrypoint and the proposal-only Friday scheduler. Observe real push/closed
   wakeups, the five-minute compensation poll and the shared persistent lock.
   A failed release is an incident; a read-only empty-cycle result does not
   authorize bypassing a failed publication or starting another cycle.
6. Let the single controller create the recorded sync PR. The maintainer reviews
   the captured merge tree and exact head/base, then merges with a merge commit
   containing `[skip ci]`. Obtain fresh feature head/integration base checks and
   maintainer validation receipts before resuming integration.

Keep checkpoints, snapshots and logs. Restore missing state; never initialize a
replacement journal to dismiss HOLD. Expiry, conflicts or drift stop the cycle.

## Normal-cycle observation ledger

No production promotion cycle has been observed for this implementation yet.
Fill these rows only from real, authorized operation; an empty row is not a pass.

| Cycle | Promotion and exact H/B | Beta/stable package and registry evidence | Sync PR and human merge | Queue receipts / ACTIVE | Missed or duplicate proposals; recovery duration |
| --- | --- | --- | --- | --- | --- |
| 1 | Pending | Pending | Pending | Pending | Pending |
| 2 | Pending | Pending | Pending | Pending | Pending |
| 3 | Pending | Pending | Pending | Pending | Pending |
| 4 | Pending | Pending | Pending | Pending | Pending |

Do not close the governance task until the eight remediation areas and actual
repository integration have the required evidence. See [the operator runbook](release-train.md)
for the executable sequence and failure handling.

## Media compatibility and dependency scope

Export uses the SDK to render Markdown, including reference images. The SDK image
callback is used only to detect unsupported URI schemes; it returns the original
resource because SDK replacement currently also changes matching prose/code.
Temporary internal scheme markers preserve visible `local://` references through
SDK sanitization. Only the final identified image attributes are inlined. Original
Markdown still supplies code-aware TODO/TBD diagnostics; final HTML supplies the
unresolved-resource check. Local file/clipboard output is the same final HTML.

`bmp-ts@^1.0.9` is the only added runtime dependency in this follow-up. It has no
runtime dependencies and does not change the Node engine or any other pinned
package. The adapter checks the BMP container before the decoder can allocate:
64 MiB input, 16 million pixels, bounded headers/palettes/scanlines, uncompressed
Windows BI_RGB with 1/4/8/16/24/32-bit pixels. A normalized container works around
the library's pixel-offset, extended-header and odd-width 4-bit assumptions;
the padded decoder dimensions also obey the 16 MP limit. bmp-ts owns pixel
decoding, and Sharp crops, produces and validates PNG. Unsupported encodings fail
explicitly rather than producing a filesystem fallback.

## Final local validation for this follow-up

Node `22.22.2`; all commands below exited zero on 2026-11-03:

| Command | Result | Measured duration |
| --- | --- | --- |
| `npm run lint` | 0 errors, 10 existing warnings | 997 ms |
| `npm test` | 231 tests across 27 files passed | 2554 ms |
| `npm run build` | Passed | 860 ms |
| `npm run test:package` | Actual 49-file tarball installed; root import and CLI smoke passed | 11971 ms |
| `git diff --check` | Passed | Not timed |

The unchanged shared controller retains its earlier 54 lifecycle/37 skill-contract
test evidence and merged PR #95's successful Unit tests check. Focused independent
review verified BMP odd-width multi-row pixels in both directions and the bounded
decoder allocation. An intermediate Buffer type error was corrected before the
successful full build above.

Previously observed normal preview `1.4.0-dev.pr21.39fc856` published to npm and
GitHub Packages and its exact CLI version was installed successfully. That proves
the restored `release.yml` publishing identity, not publication of this follow-up;
record its new head's remote result separately after pushing. The external
deployment still reports `STAGED`, zero cycles, and no local credential. No
operator approval, promotion merge or `ACTIVE` transition is inferred from tests.
