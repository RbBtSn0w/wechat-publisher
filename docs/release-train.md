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
- Repository-scoped `RELEASE_TRAIN_TOKEN`: Contents and Pull requests write plus
  check/status read, without ruleset bypass. Provide it through GitHub Secrets;
  never place credentials in policy, journal, command arguments or logs.
- Publication credentials/trusted publishing must be configured separately. Code
  promotion, npm publication, GitHub Packages mirroring and lifecycle completion
  are distinct results. The initial credential inventory found no Actions secrets.

Keep the journal, checkpoints and policy backups. Do not automatically delete or
rotate them; retention/garbage collection requires a separate owner decision.
Only trusted default-branch controller code runs on the persistent runner. PR
builds never execute on it. Events are wakeups, not authority or command payloads.

## Human promotion and synchronization

Friday proposals run at 15:00 Beijing time (UTC+8), 07:00 UTC. The proposal checks
releasable changes and deduplicates open PRs; it never enables auto-merge. Closing
references from promoted feature PRs are carried forward.

Before promotion, pause integration/main writers and affected PR queue admissions
and head/base edits. Record separate acknowledgements; CI cannot supply them.
Use a unique cycle ID and the live promotion head `H`, main base `B` and PR number.
Run the controller from the approved revision with the existing policy:

```bash
python3 scripts/release_train_lifecycle.py --config "$POLICY" status
python3 scripts/release_train_lifecycle.py --config "$POLICY" analyze --head "$H" --base "$B"
python3 scripts/release_train_lifecycle.py --config "$POLICY" --apply prepare \
  --cycle "$CYCLE" --pr "$PR" --head "$H" --base "$B" \
  --writers-paused --queue-edits-paused --lease-seconds 1800
python3 scripts/release_train_lifecycle.py --config "$POLICY" --apply promote \
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
python3 scripts/release_train_lifecycle.py --config "$POLICY" --apply validate \
  --cycle "$CYCLE" --pr "$FEATURE_PR" --head "$FEATURE_HEAD" \
  --base "$CURRENT_DEVELOP_SHA" --evidence "$VALIDATION_EVIDENCE"
python3 scripts/release_train_lifecycle.py --config "$POLICY" --apply reconcile --cycle "$CYCLE"
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
