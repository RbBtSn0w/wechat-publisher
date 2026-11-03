# Release train operations

## Policy and ownership

`main` is stable and `develop` is retained integration. Both require PRs and the
`Continuous Integration` and `Validate base branch` checks. Existing deletion and
non-fast-forward restrictions remain; no bypass actor is configured. Ordinary PR
heads stay eligible for automatic cleanup. All PR merges belong to maintainers.

The supplied shared controller is copied without target-specific changes. Its
source revision and SHA-256 are recorded in `scripts/release-train-controller.json`.
Update it only after the shared fixture suite passes, review the diff, and finish
all pending cycles before changing controller or policy versions.

The repository owner, `RbBtSn0w`, owns each cycle and HOLD resolution. The approved
policy uses `retained` mode with `sync_strategy: reviewed-pr`; it cannot recreate a
missing develop or update it directly. Unexpected deletion requires manual incident
recovery with preserved checkpoints, not initialization from main.

## Deployment prerequisites

- One dedicated persistent macOS runner named `wechat-publisher-release-train`,
  labelled `release-train-wechat-publisher`; ordinary CI uses hosted runners.
- Policy at `/Users/snow/Library/Application Support/wechat-publisher-release-train/policy.json`
  and journal below the sibling `state` directory, outside the Actions checkout.
  Directories are operator-only (0700), and policy is 0600. Initial provisioning is
  explicit; a missing journal later requires restoration, never reinitialization.
- Repository variable `RELEASE_TRAIN_POLICY_PATH` points to that policy. Variable
  `RELEASE_TRAIN_ENABLED` stays `false` until all prerequisites and bootstrap review
  are complete. Neither presence of a runner nor a passing local test activates it.
- Repository variable `RELEASE_TRAIN_CONTROLLER_PATH` points to the versioned,
  operator-private controller outside the checkout. The workflow checks its bytes
  against `scripts/release-train-controller.json` before delegating reconciliation.
  It also checks policy/state ownership, private permissions, repository identity,
  and event identity. Missing state is an error; preflight never initializes it.
- Reuse the existing `rbbtsn0w-bot` GitHub App. Set repository variable
  `RELEASE_TRAIN_APP_CLIENT_ID` and secret `RELEASE_TRAIN_APP_PRIVATE_KEY`; install the App
  on this repository with Contents and Pull requests write plus check/status read,
  without ruleset bypass. Both proposal and lifecycle jobs mint installation
  tokens restricted to this repository and these permissions using the pinned
  official `actions/create-github-app-token` action. Tokens expire after one hour
  and are revoked on job completion. No persistent `RELEASE_TRAIN_TOKEN` is needed.
  Never place credentials in policy, journal, command arguments or logs.
- Publication credentials/trusted publishing must be configured separately. Code
  promotion, npm publication, GitHub Packages mirroring and lifecycle completion
  are distinct results. The initial credential inventory found no Actions secrets.

Keep the journal, checkpoints and policy backups. Do not automatically delete or
rotate them; retention/garbage collection requires a separate owner decision.
Only trusted default-branch controller code runs on the persistent runner. PR
builds never execute on it. Events are wakeups, not authority or command payloads.
The runner must support Node 24 actions (runner 2.327.1 or newer); this does not
change the package's Node engine. App installation alone is not authentication:
the repository must have access to its private-key secret. Store the key through
the Actions settings UI or a secure operator-managed secret source, never chat.

Use the local, read-only deployment check after provisioning or recovery:

```bash
python3 scripts/release-train-preflight.py \
  --config "$POLICY" --controller "$CONTROLLER" \
  --provenance scripts/release-train-controller.json --check
```

`STAGED` means only that the local deployment passed inspection. The reported
credential presence is not proof of token scope or remote write authority. An
empty initial state directory is not an observed `ACTIVE` cycle. Preserve the
append-only cycle snapshots in that directory; if it disappears, restore it from
operator backups rather than creating an empty replacement.

For the bootstrap gap before these workflows reach main, an operator can invoke
the already reviewed absolute `CONTROLLER` path with the commands below. Use that
same controller and policy for independent manual reconciliation after the human
merge. Do not use a PR checkout as the trusted bootstrap executable. The scheduled
workflow must stay disabled until the proposal-only definition is on main;
re-enabling the old default-branch workflow restores its old merge path.

## npm publication identity

Stable, beta and same-repository PR previews publish from `release.yml`. Keep
this filename: the existing npm trusted publisher binds the GitHub repository
and workflow filename, not the displayed job name. Moving a publish job to
`ci.yml` changes its OIDC identity and can fail with `ENEEDAUTH` even when
`id-token: write` is present. `--provenance` alone is not authentication.

In npm package settings for `@rbbtsn0w/wechat-publisher`, verify the GitHub
publisher uses owner `RbBtSn0w`, repository `wechat-publisher`, workflow
`release.yml`, and permits direct `npm publish`. No environment is configured
by these jobs. Do not replace a working publisher or create a token merely to
rename a workflow. GitHub-hosted publication requires npm >=11.5.1 and Node
>=22.14.0; these workflows use Node 24. An explicitly supplied `NPM_TOKEN`
remains supported, but is not required for the configured OIDC identity.

Preview publication runs its own lint, tests, build and package smoke on the
exact same-repository PR head before publishing `next`. Its per-PR concurrency
group is separate from the stable/beta lifecycle group. Check the real package
version and registry before rerunning a failed publish; do not infer successful
authentication from a dry run. Verbose npm output records OIDC exchange failures
without printing credential values.

## Human promotion and synchronization

Friday proposals run at 15:00 Beijing time (UTC+8), 07:00 UTC. The proposal checks
releasable changes and deduplicates open PRs; it never enables auto-merge. Closing
references from promoted feature PRs are carried forward.

Before promotion, pause integration/main writers and affected PR queue admissions
and head/base edits. Record separate acknowledgements; CI cannot supply them.
Use a unique cycle ID and the live promotion head `H`, main base `B` and PR number.
Run the controller from the approved revision with the existing policy:

```bash
python3 "$CONTROLLER" --config "$POLICY" status
python3 "$CONTROLLER" --config "$POLICY" analyze --head "$H" --base "$B"
python3 "$CONTROLLER" --config "$POLICY" --apply prepare \
  --cycle "$CYCLE" --pr "$PR" --head "$H" --base "$B" \
  --writers-paused --queue-edits-paused --lease-seconds 1800
python3 "$CONTROLLER" --config "$POLICY" --apply promote \
  --cycle "$CYCLE" --approval human-required
```

A maintainer reviews exact `H/B`, required checks and merge content, then performs
the human merge using the SOP. Agents do not run merge commands. Use a merge commit
for this repository. Changed head/base invalidates the approval.

After publishing jobs settle, the single reconciler records the accepted main
SHA, creates a create-only synchronization head and opens one bound sync PR into
develop. It remains `WAITING_SYNC_MERGE`. A maintainer reviews and merges that PR
using a merge commit whose message includes `[skip ci]`. Squash/rebase would lose
the required ancestry and are rejected. Tree-identical sync can still be required
for ancestry; it is not permission to skip the cycle.

Reconciliation verifies the sync PR's repository, exact head/base, merge parents,
result tree and human merger. Feature queue evidence must then name each exact
feature head and the independently read current develop SHA:

```bash
python3 "$CONTROLLER" --config "$POLICY" --apply validate \
  --cycle "$CYCLE" --pr "$FEATURE_PR" --head "$FEATURE_HEAD" \
  --base "$CURRENT_DEVELOP_SHA" --evidence "$VALIDATION_EVIDENCE"
python3 "$CONTROLLER" --config "$POLICY" --apply reconcile --cycle "$CYCLE"
```

Resume writers only after `ACTIVE`. No automated job fabricates validation receipts
or renews the freeze lease. An interrupted sync-PR creation is inspected before any
new write. Changed refs, conflicting content, a closed PR, unknown write outcome,
missing state or expired coordination enters HOLD.

## Delivery, bootstrap and failure

Lifecycle push/closed/delete/dispatch events share one concurrency group with
publication. Independent polling every five minutes recovers lost wakeups;
Actions concurrency is not a distributed writer lock or durable event queue.
The lease is 30 minutes; the operational target is reconciliation within 10 minutes
after publication tasks settle, subject to manual review. Neither is a GitHub SLA.
The lease starts at `prepare` and covers the entire cycle: promotion review and
merge, publication, sync PR checks and human merge, and fresh queue validation.
Before preparing, coordinate both human merge windows and check runner/CI capacity.
If these steps cannot fit within 30 minutes, postpone preparation. A cycle that
exceeds that budget is expected to enter HOLD, even if publication succeeded;
the 10-minute target does not extend the lease. Preserve its checkpoint and use
the documented incident recovery process. Do not renew the lease automatically
or prepare a replacement cycle over an unfinished one. The 30-minute budget is
an explicit repository policy, not an estimate of typical CI or review duration.

For bootstrap, review and provision the trusted controller before the first main
promotion. Prepare a normal checkpointed cycle even though workflows are not yet
registered on main. Keep an independent human dispatch available until main
registration and periodic delivery are observed. Do not use an unreviewed PR copy
or mark a staged configuration operational.

On failure, stop the next train, preserve journal and checkpoints, inspect the
named HOLD reason and owner action in Actions logs/summary, and restore validated
state if necessary. Do not reset/force-push branches, disable cleanup, discard the
journal, blindly retry a write or implicitly revert published code. Mirror
publication failures remain failures. Retry publication only after checking the
exact version and registry state.

## Validation evidence

Local: application lint/tests/build, actual tarball installation smoke, workflow
contract tests, shared controller fixture and skill-contract suites. Remote:
observe one normal feature PR, human promotion, actual package versions, human
sync PR and exact queue validation. Track the first four normal cycles; do not
create rehearsal repositories, synthetic PRs, test-only releases or remote fault
injection. Record staged, deployed and operationally observed evidence separately.
