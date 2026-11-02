#!/usr/bin/env python3
"""A conservative GitHub release-train controller for one persistent POSIX host.

Python 3.10+, standard library only. Remote writes require --apply. The journal and
writer freeze are cooperative operating controls, not GitHub branch protection.
"""

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import quote, unquote


class Hold(RuntimeError):
    """An invariant needs an operator decision; never retry it as transient."""


class APIError(RuntimeError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


class GitHub:
    def __init__(self, executable=None):
        self.executable = executable or ("/opt/homebrew/bin/gh" if Path("/opt/homebrew/bin/gh").exists() else shutil.which("gh"))
        if not self.executable:
            raise ValueError("GitHub CLI is required")

    def request(self, method, path, payload=None):
        command = [self.executable, "api", "--hostname", "github.com", "--include", "--method", method, path]
        if payload is not None:
            command += ["--input", "-"]
        for attempt in range(3):
            try:
                result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                                        capture_output=True, text=True, timeout=60)
            except subprocess.TimeoutExpired as error:
                raise APIError(None, "GitHub request timed out; write outcome may be unknown") from error
            parts = re.split(r"\r?\n\r?\n", result.stdout, maxsplit=1)
            match = re.search(r"^HTTP/\S+\s+(\d+)", parts[0])
            status = int(match.group(1)) if match else None
            if result.returncode == 0 and status and 200 <= status < 300:
                return json.loads(parts[1]) if len(parts) > 1 and parts[1].strip() else None
            if method == "GET" and status in (429, 502, 503, 504) and attempt < 2:
                time.sleep(attempt + 1)
                continue
            # Do not print payloads, credentials, environment, or arbitrary CLI diagnostics.
            raise APIError(status, f"GitHub {method} failed (HTTP {status or 'unavailable'}); no automatic write retry")


class Store:
    """Append-only, fsync'd snapshots; flock coordinates controllers on this host."""

    def __init__(self, root):
        self.root = Path(root)
        if not self.root.is_absolute() or self.root.is_symlink():
            raise ValueError("state_dir must be an absolute persistent directory, not a symlink")
        if not self.root.is_dir():
            raise ValueError("Persistent state directory is unavailable; initialize it explicitly only during approved adoption")

    @contextlib.contextmanager
    def lock(self):
        with (self.root / ".lock").open("a") as handle:
            deadline = time.monotonic() + 30
            while True:
                try:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise Hold("Another lifecycle controller holds the state lock")
                    time.sleep(0.1)
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def directory(self, cycle):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", cycle):
            raise ValueError("Invalid cycle identifier")
        path = self.root / cycle
        if path.is_symlink():
            raise ValueError("Cycle directory cannot be a symlink")
        return path

    def load(self, cycle):
        files = sorted(self.directory(cycle).glob("[0-9]*.json"))
        if not files:
            raise Hold(f"No durable cycle exists: {cycle}")
        return json.loads(files[-1].read_text())

    def cycles(self):
        return [self.load(p.name) for p in sorted(self.root.iterdir()) if p.is_dir() and
                not p.is_symlink() and any(p.glob("[0-9]*.json"))]

    def save(self, record):
        directory = self.directory(record["cycle"])
        directory.mkdir(exist_ok=True, mode=0o700)
        files = sorted(directory.glob("[0-9]*.json"))
        sequence = int(files[-1].stem) + 1 if files else 1
        target = directory / f"{sequence:08d}.json"
        pending = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", prefix=".pending-", dir=directory, delete=False) as handle:
                pending = Path(handle.name)
                json.dump(record, handle, sort_keys=True, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            # Publish an already-complete inode atomically without replacing any history.
            os.link(pending, target)
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)
        for parent in (directory, self.root):
            descriptor = os.open(parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        return record


def serialized(function):
    def run(self, *args, **kwargs):
        with self.store.lock():
            return function(self, *args, **kwargs)
    return run


def valid_ref(ref):
    return (isinstance(ref, str) and bool(ref) and ref != "@" and
            not any(x in ref for x in ("..", "@{", "//", "\\")) and
            not re.search(r"[\x00-\x20\x7f~^:?*\[]", ref) and
            all(part and not part.startswith(".") and not part.endswith((".", ".lock")) for part in ref.split("/")))


def validate_config(config):
    if config.get("schema") != 1 or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", config.get("repository", "")):
        raise ValueError("schema=1 and an explicit owner/repository are required")
    if not isinstance(config.get("repository_id"), int):
        raise ValueError("Pin the numeric repository_id before permitting writes")
    if config.get("mode") not in ("recreatable", "retained", "snapshot"):
        raise ValueError("Unsupported lifecycle mode")
    if config.get("writer_model") != "cooperative-single-host":
        raise ValueError("This controller requires one persistent POSIX host and coordinated writers")
    refs = [config.get(key) for key in ("stable_branch", "integration_branch", "checkpoint_prefix")]
    if not all(valid_ref(ref) for ref in refs) or len(set(refs)) != len(refs):
        raise ValueError("Use distinct valid stable, integration, and checkpoint refs")
    stable, integration, checkpoint = refs
    if any(checkpoint.startswith(ref + "/") or ref.startswith(checkpoint + "/") for ref in (stable, integration)):
        raise ValueError("Checkpoint namespace must not overlap trunk refs")
    if config.get("sync_strategy", "direct") not in ("direct", "reviewed-pr"):
        raise ValueError("Unsupported sync strategy")
    if config.get("sync_strategy") == "reviewed-pr":
        sync = config.get("sync_prefix", "release-train/sync")
        namespaces = refs + ([config.get("snapshot_prefix", "release")] if config["mode"] == "snapshot" else [])
        if not valid_ref(sync) or any(sync == ref or sync.startswith(ref + "/") or
                                      ref.startswith(sync + "/") for ref in namespaces):
            raise ValueError("Reviewed sync requires a dedicated, non-overlapping sync namespace")
        if config.get("rehearsal_prefix") and not sync.startswith(config["rehearsal_prefix"] + "/"):
            raise ValueError("Reviewed sync rehearsal heads must stay inside the rehearsal namespace")
    if config.get("merge_method", "merge") not in ("merge", "squash", "rebase"):
        raise ValueError("Unsupported merge method")
    if not isinstance(config.get("required_checks"), list) or not all(isinstance(x, str) and x for x in config["required_checks"]):
        raise ValueError("required_checks must explicitly list expected check/context names")
    prefix = config.get("rehearsal_prefix")
    if prefix and (not valid_ref(prefix) or not prefix.startswith("codex/release-train-eval-")):
        raise ValueError("Rehearsals require a dedicated codex/release-train-eval-* namespace")
    if prefix and not all(ref.startswith(prefix + "/") for ref in refs):
        raise ValueError("All rehearsal write refs must stay within the rehearsal namespace")
    if config["mode"] == "snapshot" and not valid_ref(config.get("snapshot_prefix", "release")):
        raise ValueError("Snapshot promotion requires a valid dedicated namespace")
    if prefix and config["mode"] == "snapshot" and not config.get("snapshot_prefix", "").startswith(prefix + "/"):
        raise ValueError("Snapshot rehearsal heads must stay inside the rehearsal namespace")
    return config


class Controller:
    def __init__(self, api, config, store, now=time.time):
        self.api, self.config, self.store, self.now = api, validate_config(config), store, now
        self.repo = "repos/" + config["repository"]
        self.stable, self.integration = config["stable_branch"], config["integration_branch"]
        self.policy = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()

    def call(self, method, path="", payload=None):
        return self.api.request(method, self.repo + path, payload)

    def live(self):
        repo = self.call("GET")
        if repo["id"] != self.config["repository_id"] or repo["full_name"].lower() != self.config["repository"].lower():
            raise Hold("Repository identity changed")
        if not repo["delete_branch_on_merge"]:
            raise Hold("Automatic head cleanup must remain enabled")
        if not self.config.get("rehearsal_prefix") and repo["default_branch"] != self.stable:
            raise Hold("Stable branch must be the default branch outside isolated rehearsal")
        if self.config.get("rehearsal_prefix") and repo["default_branch"] in (self.stable, self.integration):
            raise Hold("Rehearsal cannot consume the actual default branch")
        return repo

    def ref(self, name):
        refs = self.call("GET", "/git/matching-refs/heads/" + quote(name, safe=""))
        exact = [entry["object"]["sha"] for entry in refs if entry["ref"] == "refs/heads/" + name]
        return exact[0] if exact else None

    def commit(self, sha):
        if not re.fullmatch(r"[A-Za-z0-9]+", sha):
            raise ValueError("Invalid commit identifier")
        return self.call("GET", "/git/commits/" + sha)

    def ancestor(self, older, newer):
        return older == newer or self.call("GET", f"/compare/{older}...{newer}")["status"] == "ahead"

    def open_prs(self):
        result = []
        for page in range(1, 21):
            items = self.call("GET", f"/pulls?state=open&per_page=100&page={page}")
            result.extend(items)
            if len(items) < 100:
                return result
        raise Hold("PR inventory exceeds the bounded pagination limit")

    def guard_empty_journal(self, records):
        if not records:
            refs = self.call("GET", "/git/matching-refs/heads/" + quote(self.config["checkpoint_prefix"] + "/", safe=""))
            if refs:
                raise Hold("Remote checkpoints exist without the local journal; restore the journal, never invent new authority")

    def pr(self, number):
        return self.call("GET", f"/pulls/{int(number)}")

    def identity(self, pr):
        return all(pr[side].get("repo") and pr[side]["repo"]["id"] == self.config["repository_id"] for side in ("head", "base"))

    def snapshot_pr(self, pr):
        return {"number": pr["number"], "head": pr["head"]["sha"], "head_ref": pr["head"]["ref"],
                "head_repo": pr["head"]["repo"]["id"] if pr["head"].get("repo") else None,
                "base": pr["base"]["ref"]}

    def ensure_ref(self, name, sha):
        current = self.ref(name)
        if current is not None:
            if current != sha:
                raise Hold("A create-only ref already exists at a different commit")
            return
        try:
            self.call("POST", "/git/refs", {"ref": "refs/heads/" + name, "sha": sha})
        except APIError:
            # A timeout may have committed the write. Never retry POST blindly or advance an ancestor ref.
            if self.ref(name) != sha:
                raise
        if self.ref(name) != sha:
            raise Hold("Create-only ref result does not match the accepted target")

    def save(self, record, phase=None, **fields):
        record.update(fields)
        if phase:
            record["phase"] = phase
        record["updated_at"] = self.now()
        return self.store.save(record)

    def hold(self, record, reason):
        self.save(record, "HOLD", reason=reason)
        raise Hold(reason)

    def guard(self, record):
        if record["policy"] != self.policy:
            self.hold(record, "Policy changed during a pending cycle")
        if self.now() >= record["lease_expires_at"]:
            self.hold(record, "Writer-freeze lease expired; acquire a new reviewed recovery plan")
        if record["phase"] == "HOLD":
            raise Hold(record.get("reason", "Cycle is held"))

    def exact_premerge(self, record):
        self.guard(record)
        self.live()
        pr = self.pr(record["pr"])
        integration = self.ref(self.integration)
        if integration is not None and integration != record["integration_head"]:
            self.preserve_observed(record, integration)
        if (not self.identity(pr) or pr["state"] != "open" or pr.get("draft") or
                pr["head"]["sha"] != record["head"] or pr["head"]["ref"] != record["promotion_head"] or
                pr["base"]["ref"] != self.stable or self.ref(self.stable) != record["base"] or
                integration != record["integration_head"]):
            self.hold(record, "Head, base, PR identity, or coordinated writer state changed")
        return pr

    @serialized
    def analyze(self, head, base):
        self.live()
        if self.ancestor(head, base) or self.commit(head)["tree"]["sha"] == self.commit(base)["tree"]["sha"]:
            return "no-op"
        completed = [r for r in self.store.cycles() if r["phase"] == "ACTIVE" and r["policy"] == self.policy]
        if completed:
            accepted = max(completed, key=lambda r: r["updated_at"])["head"]
            if self.ancestor(head, accepted):
                return "no-op"
            if self.ancestor(accepted, head):
                base = accepted
        comparison = self.call("GET", f"/compare/{base}...{head}")
        if comparison["total_commits"] > len(comparison["commits"]):
            raise Hold("Commit analysis is incomplete; split or review the promoted range")
        if not comparison.get("files"):
            return "no-op"
        messages = [c["commit"]["message"] for c in comparison["commits"]]
        return "releasable" if any(not re.match(r"^(chore|docs|ci|test|style|build)(\([^\n]+\))?:", m) or
                                  "BREAKING CHANGE:" in m for m in messages) else "no-op"

    @serialized
    def prepare(self, cycle, pr_number, head, base, writers_paused=False, lease_seconds=1800, queue_edits_paused=False):
        self.store.directory(cycle)
        self.live()
        if not writers_paused or not queue_edits_paused or not 60 <= lease_seconds <= 7200:
            raise Hold("Separate acknowledgements of paused trunk writers AND affected PR queue edits, with a bounded lease, are required")
        actor = self.api.request("GET", "user")
        if actor.get("type") != "User":
            raise Hold("Writer-freeze acknowledgement requires an operator user identity")
        records = self.store.cycles()
        self.guard_empty_journal(records)
        for previous in records:
            if previous["cycle"] == cycle:
                if previous["head"] != head or previous["base"] != base or previous["pr"] != pr_number:
                    raise Hold("A cycle identifier cannot be reused for different approval evidence")
                self.exact_premerge(previous)
                if previous["phase"] == "PREPARING":
                    self.ensure_ref(previous["checkpoint"], head)
                    self.ensure_ref(f"{self.config['checkpoint_prefix']}/{cycle}/base", base)
                    self.exact_premerge(previous)
                    return self.save(previous, "PREPARED")
                return previous
            if previous["phase"] != "ACTIVE":
                raise Hold("Another cycle is pending or held; do not supersede its deletion authority")
        pr = self.pr(pr_number)
        integration_head = self.ref(self.integration)
        promotion_head = pr["head"]["ref"]
        expected_head = self.integration if self.config["mode"] != "snapshot" else None
        if (not self.identity(pr) or pr["base"]["ref"] != self.stable or pr["state"] != "open" or
                pr.get("draft") or not pr.get("mergeable") or pr["head"]["sha"] != head or
                self.ref(self.stable) != base or integration_head != head or
                (expected_head is not None and promotion_head != expected_head)):
            raise Hold("Preparation requires the exact live, mergeable same-repository promotion head/base")
        if self.config["mode"] == "snapshot" and not promotion_head.startswith(self.config.get("snapshot_prefix", "release") + "/"):
            raise Hold("Snapshot promotion must use the configured dedicated release namespace")
        test_merge = self.commit(pr["merge_commit_sha"])
        if {p["sha"] for p in test_merge["parents"]} != {head, base}:
            raise Hold("GitHub test merge is stale or not bound to the approved head/base")
        inventory = self.open_prs()
        record = {"schema": 1, "cycle": cycle, "policy": self.policy, "repository_id": self.config["repository_id"],
                  "pr": pr_number, "head": head, "base": base, "integration_head": integration_head,
                  "promotion_head": promotion_head, "expected_tree": test_merge["tree"]["sha"],
                  "merge_method": self.config.get("merge_method", "merge"), "commit_count": pr.get("commits"),
                  "checkpoint": f"{self.config['checkpoint_prefix']}/{cycle}/head",
                  "phase": "PREPARING", "operator": actor["login"], "created_at": self.now(),
                  "coordination": {"integration_writers_paused": True, "stable_writers_paused": True,
                                   "pr_queue_edits_paused": True},
                  "lease_expires_at": self.now() + lease_seconds,
                  "queue": [self.snapshot_pr(p) for p in inventory if p["base"]["ref"] == self.integration],
                  "known_prs": [p["number"] for p in inventory], "validations": {}, "repairs": {}}
        self.save(record)
        self.ensure_ref(record["checkpoint"], head)
        self.ensure_ref(f"{self.config['checkpoint_prefix']}/{cycle}/base", base)
        self.exact_premerge(record)
        return self.save(record, "PREPARED")

    @serialized
    def promote(self, cycle, approval):
        record = self.store.load(cycle)
        self.exact_premerge(record)
        if approval != "human-required":
            raise Hold("This controller intentionally supports human promotion only; no unattended auto-merge is armed")
        return self.save(record, "WAITING_HUMAN", approval="human-required")

    def check_results(self, sha):
        names = self.config["required_checks"]
        if not names and not self.config.get("rehearsal_prefix"):
            raise Hold("Production promotion requires explicitly named successful checks")
        if not names:
            return
        runs = self.call("GET", f"/commits/{sha}/check-runs?per_page=100")
        if runs["total_count"] > len(runs["check_runs"]):
            raise Hold("Check inventory exceeds the bounded first page")
        outcomes = {}
        for run in sorted(runs["check_runs"], key=lambda r: r["id"]):
            outcomes[run["name"]] = run["status"] == "completed" and run["conclusion"] == "success"
        statuses = self.call("GET", f"/commits/{sha}/status?per_page=100")
        if statuses["total_count"] > len(statuses["statuses"]):
            raise Hold("Status inventory exceeds the bounded first page")
        for status in reversed(statuses["statuses"]):
            outcomes[status["context"]] = status["state"] == "success"
        if not all(outcomes.get(name) for name in names):
            raise Hold("A required check is absent, pending, cancelled, skipped, or unsuccessful")

    @serialized
    def merge(self, cycle, human_approval=False):
        record = self.store.load(cycle)
        if not human_approval or record["phase"] != "WAITING_HUMAN":
            raise Hold("Explicit human approval of a waiting exact-head/base cycle is required")
        self.exact_premerge(record)
        actor = self.api.request("GET", "user")
        if actor.get("type") != "User":
            raise Hold("A bot cannot supply human approval")
        self.check_results(record["head"])
        self.exact_premerge(record)
        self.save(record, "MERGING", approved_by=actor["login"])
        # sha protects head atomically. The separately acknowledged main-writer freeze protects base.
        result = self.call("PUT", f"/pulls/{record['pr']}/merge",
                           {"sha": record["head"], "merge_method": self.config.get("merge_method", "merge")})
        if not result.get("merged"):
            self.hold(record, "GitHub did not merge the approved PR; inspect before retrying")
        return self.save(record, "PROMOTED_WAITING", merge=result["sha"])

    def preserve_observed(self, record, sha):
        self.ensure_ref(f"{self.config['checkpoint_prefix']}/{record['cycle']}/observed-{sha}", sha)

    def verify_merged_base(self, record, commit, approval=None):
        expected = approval or record
        parents = [parent["sha"] for parent in commit["parents"]]
        if expected["merge_method"] == "merge":
            accepted = parents == [expected["base"], expected["head"]]
        elif expected["merge_method"] == "squash":
            accepted = parents == [expected["base"]]
        else:
            count = expected["commit_count"]
            if not isinstance(count, int) or not 1 <= count <= 250:
                self.hold(record, "Cannot verify the bounded rebase commit chain against the approved base")
            current = commit
            for _ in range(count):
                if len(current["parents"]) != 1:
                    self.hold(record, "Rebased result has an unexpected parent chain")
                parent = current["parents"][0]["sha"]
                current = self.commit(parent)
            accepted = parent == expected["base"]
        if not accepted:
            self.hold(record, "Merged result does not use the exact approved base and merge method")

    def sync_existing(self, record, current, target):
        if self.ancestor(target, current):
            return current
        if not self.ancestor(current, target):
            self.hold(record, "Existing integration contains divergent work; prepare a reviewed sync PR, never reset or force-push")
        self.guard(record)
        # PATCH updates an existing ref only and cannot recreate a concurrently deleted base.
        self.call("PATCH", "/git/refs/heads/" + quote(self.integration, safe=""), {"sha": target, "force": False})
        observed = self.ref(self.integration)
        if observed is None or not self.ancestor(target, observed):
            self.hold(record, "Integration changed or disappeared during existing-ref sync")
        return observed

    def sync_candidates(self, branch):
        # Include closed PRs: a lost create response may be followed by a human merge/close.
        owner = self.config["repository"].split("/", 1)[0]
        query = quote(owner + ":" + branch, safe="")
        result = []
        for page in range(1, 21):
            items = self.call("GET", f"/pulls?state=all&head={query}&per_page=100&page={page}")
            result.extend(items)
            if len(items) < 100:
                return result
        raise Hold("Sync PR inventory exceeds the bounded pagination limit")

    def sync_identity(self, sync, pr):
        return (self.identity(pr) and pr["head"]["ref"] == sync["branch"] and
                pr["head"]["sha"] == sync["head"] and pr["base"]["ref"] == self.integration)

    def verify_sync_refs(self, record, sync, base, merged=False):
        current = self.ref(self.integration)
        if current != base:
            if current is not None:
                self.preserve_observed(record, current)
            self.hold(record, "Integration changed during sync verification")
        branch = self.ref(sync["branch"])
        if (self.ref(self.stable) != sync["head"] or
                (branch != sync["head"] and not (merged and branch is None))):
            self.hold(record, "Main or the dedicated sync branch changed during sync verification")
        self.guard(record)

    def reviewed_sync(self, record, current, target):
        sync = record.get("sync")
        if sync is None:
            expected = record.get("target", record["integration_head"])
            if current != expected:
                self.preserve_observed(record, current)
                self.hold(record, "Integration changed before reviewed sync; preserve concurrent work")
            if self.ancestor(target, current):
                return current
            self.repair(record)
            sync = {"branch": f"{self.config.get('sync_prefix', 'release-train/sync')}/{record['cycle']}",
                    "head": target, "base": current, "merge_method": "merge", "creation_attempted": False}
            # Persist all authority before creating either the dedicated ref or PR.
            self.save(record, "WAITING_SYNC_MERGE", sync=sync, merge=record.get("merge"))
        if target != sync["head"]:
            self.hold(record, "Main changed during reviewed sync; retain the fixed sync intent")
        branch_tip = self.ref(sync["branch"])
        if branch_tip is not None and branch_tip != sync["head"]:
            self.preserve_observed(record, branch_tip)
            self.hold(record, "Create-only sync branch changed")
        if "pr" not in sync:
            if current != sync["base"]:
                if current is not None:
                    self.preserve_observed(record, current)
                self.hold(record, "Integration changed before sync PR registration")
            candidates = self.sync_candidates(sync["branch"])
            if len(candidates) > 1:
                self.hold(record, "Multiple sync PRs match the durable intent")
            if candidates:
                sync["pr"] = candidates[0]["number"]
                self.save(record)
            else:
                if sync["creation_attempted"]:
                    self.hold(record, "Sync PR creation outcome is unknown; never repost blindly")
                self.guard(record)
                self.ensure_ref(sync["branch"], sync["head"])
                self.repair(record)
                if self.ref(self.integration) != sync["base"] or self.ref(self.stable) != sync["head"]:
                    self.hold(record, "Trunk changed before sync PR creation")
                self.guard(record)
                sync["creation_attempted"] = True
                self.save(record)
                try:
                    pr = self.call("POST", "/pulls", {
                        "head": sync["branch"], "base": self.integration,
                        "title": f"chore(release): sync main for {record['cycle']}",
                        "body": "Human merge commit required. Preserve the exact recorded head/base and run the required checks; no auto-merge."})
                except APIError:
                    candidates = self.sync_candidates(sync["branch"])
                    if len(candidates) != 1:
                        self.hold(record, "Sync PR creation outcome is unknown; preserve intent without retry")
                    pr = candidates[0]
                sync["pr"] = pr["number"]
                self.save(record)
        branch_tip = self.ref(sync["branch"])
        pr = self.pr(sync["pr"])
        if not self.sync_identity(sync, pr):
            self.hold(record, "Sync PR head/base/repository differs from the recorded intent")
        self.repair(record)
        if pr.get("merged"):
            if (not sync.get("expected_tree") or pr.get("merged_by", {}).get("type") != "User" or
                    pr["state"] != "closed"):
                self.hold(record, "Sync requires recorded exact-tree approval and a human merger")
            self.check_results(sync["head"])
            merged = pr["merge_commit_sha"]
            commit = self.commit(merged)
            self.verify_merged_base(record, commit, approval=sync)
            if commit["tree"]["sha"] != sync["expected_tree"] or current != merged:
                if current is not None and current != merged:
                    self.preserve_observed(record, current)
                self.hold(record, "Sync result tree or live integration differs from the reviewed merge")
            if sync.get("merge") and sync["merge"] != merged:
                self.hold(record, "Previously accepted sync merge changed")
            self.verify_sync_refs(record, sync, merged, merged=True)
            if not sync.get("merge"):
                sync["merge"] = merged
                record["validations"] = {}
                self.save(record)
            return merged
        if (pr["state"] != "open" or pr.get("draft") or pr.get("mergeable") is False or
                current != sync["base"] or branch_tip != sync["head"]):
            if current is not None and current != sync["base"]:
                self.preserve_observed(record, current)
            self.hold(record, "Sync PR closed, conflicted, or its coordinated refs changed")
        if pr.get("mergeable") is None or not pr.get("merge_commit_sha"):
            self.verify_sync_refs(record, sync, sync["base"])
            return None
        test_merge = self.commit(pr["merge_commit_sha"])
        if [p["sha"] for p in test_merge["parents"]] != [sync["base"], sync["head"]]:
            self.hold(record, "Sync test merge is not bound to the exact integration/main parents")
        tree = test_merge["tree"]["sha"]
        if sync.get("expected_tree") and sync["expected_tree"] != tree:
            self.hold(record, "Sync test-merge tree changed during human review")
        sync["expected_tree"] = tree
        self.verify_sync_refs(record, sync, sync["base"])
        self.save(record, "WAITING_SYNC_MERGE")
        return None

    def repair(self, record):
        known = {q["number"] for q in record["queue"]}
        for pr in self.open_prs():
            if pr["number"] == record.get("sync", {}).get("pr"):
                if not self.sync_identity(record["sync"], pr):
                    self.hold(record, "Registered sync PR changed; its inventory exception is invalid")
                continue
            if pr["number"] not in record["known_prs"] and pr["base"]["ref"] in (self.stable, self.integration):
                self.hold(record, "New PR appeared during the freeze; inspect and quarantine explicitly")
        for item in record["queue"]:
            pr = self.pr(item["number"])
            if (pr["state"] != "open" or pr["head"]["sha"] != item["head"] or
                    not pr["head"].get("repo") or pr["head"]["repo"]["id"] != item["head_repo"] or
                    pr["head"]["ref"] != item["head_ref"] or not pr["base"].get("repo") or
                    pr["base"]["repo"]["id"] != self.config["repository_id"]):
                self.hold(record, "An inventoried PR closed or changed; preserve it for owner review")
            if pr["base"]["ref"] == self.stable:
                self.guard(record)
                self.save(record, repair_intent=item["number"])
                self.call("PATCH", f"/pulls/{item['number']}", {"base": self.integration})
                pr = self.pr(item["number"])
                if pr["base"]["ref"] != self.integration or pr["head"]["sha"] != item["head"]:
                    self.hold(record, "PR changed during base repair; do not overwrite concurrent edits")
                record["repairs"][str(item["number"])] = self.now()
                self.save(record)
            elif pr["base"]["ref"] != self.integration:
                self.hold(record, "An inventoried PR has an unexpected base; do not retarget blindly")
        return known

    @serialized
    def reconcile(self, cycle=None):
        self.live()
        if cycle is None:
            records = self.store.cycles()
            self.guard_empty_journal(records)
            pending = [r for r in records if r["phase"] != "ACTIVE"]
            if not pending:
                if self.ref(self.integration) is None:
                    raise Hold("Missing integration has no pending durable promotion authority")
                return {"phase": "ACTIVE", "result": "no pending cycle"}
            if len(pending) != 1:
                raise Hold("Multiple pending generations require owner reconciliation")
            cycle = pending[0]["cycle"]
        record = self.store.load(cycle)
        if record["phase"] == "ACTIVE":
            if self.ref(self.integration) is None:
                self.hold(record, "Unexpected deletion after lifecycle completion")
            return record
        self.guard(record)
        if self.ref(record["checkpoint"]) != record["head"]:
            self.hold(record, "Immutable promotion checkpoint is absent or changed")
        pr = self.pr(record["pr"])
        if not pr.get("merged"):
            self.exact_premerge(record)
            return record
        if (not self.identity(pr) or pr["head"]["sha"] != record["head"] or
                pr["head"]["ref"] != record["promotion_head"] or pr["base"]["ref"] != self.stable):
            self.hold(record, "Merged promotion does not match the recorded exact head/base identity")
        if record.get("approval") != "human-required" or pr.get("merged_by", {}).get("type") != "User":
            self.hold(record, "The recorded human promotion approval or human merger identity is missing")
        self.check_results(record["head"])
        merged = pr["merge_commit_sha"]
        merged_commit = self.commit(merged)
        self.verify_merged_base(record, merged_commit)
        if merged_commit["tree"]["sha"] != record["expected_tree"]:
            self.hold(record, "Merged content differs from the approved head/base test-merge tree")
        target = self.ref(self.stable)
        if target is None or not self.ancestor(merged, target):
            self.hold(record, "Main no longer includes the verified promotion result")
        current = self.ref(self.integration)
        recovering = record["phase"] in ("RECOVERING", "REPAIRING", "WAITING_VALIDATION")
        if record.get("sync"):
            current = self.reviewed_sync(record, current, target)
            if current is None:
                return record
        elif self.config["mode"] == "recreatable" and not recovering:
            if current == record["integration_head"]:
                return self.save(record, "PROMOTED_WAITING", merge=merged)
            if current is not None:
                self.preserve_observed(record, current)
                self.hold(record, "Post-checkpoint integration write observed; deletion recovery is no longer authorized")
            self.save(record, "RECOVERING", merge=merged, target=target, deletion_observed_at=self.now())
            try:
                self.ensure_ref(self.integration, target)
            except (APIError, Hold):
                winner = self.ref(self.integration)
                if winner is not None:
                    self.preserve_observed(record, winner)
                    self.hold(record, "Concurrent ref creation won at a different commit; it was not advanced")
                raise
            current = target
        elif current is None:
            if self.config["mode"] != "recreatable" or not recovering:
                self.hold(record, "Unexpected deletion in a retained lifecycle")
            # Reconcile an interrupted create or repeated deletion under the still-valid same freeze.
            self.ensure_ref(self.integration, record["target"])
            current = record["target"]
        elif recovering and current != record["target"]:
            self.preserve_observed(record, current)
            self.hold(record, "Integration changed after recovery; preserve concurrent work")
        if self.config.get("sync_strategy", "direct") == "reviewed-pr":
            if not record.get("sync"):
                current = self.reviewed_sync(record, current, target)
                if current is None:
                    return record
        else:
            current = self.sync_existing(record, current, target)
        self.save(record, "REPAIRING", target=current, merge=merged)
        known = self.repair(record)
        missing = known - {int(number) for number in record["validations"]}
        if missing:
            return self.save(record, "WAITING_VALIDATION", awaiting_prs=sorted(missing))
        # Validate again at completion; earlier receipts do not authorize a changed head/base.
        for item in record["queue"]:
            receipt = record["validations"][str(item["number"])]
            actual = self.pr(item["number"])
            if (actual["state"] != "open" or actual["base"]["ref"] != self.integration or
                    not actual["base"].get("repo") or
                    actual["base"]["repo"]["id"] != self.config["repository_id"] or
                    not actual["head"].get("repo") or actual["head"]["repo"]["id"] != item["head_repo"] or
                    actual["head"]["ref"] != item["head_ref"] or actual["head"]["sha"] != receipt["head"] or
                    receipt["head"] != item["head"] or receipt["base"] != current or
                    self.ref(self.integration) != receipt["base"]):
                self.hold(record, "Validation receipt is stale; fresh base/head verification is required")
        if self.ref(self.stable) != target or self.ref(self.integration) != current:
            self.hold(record, "Trunk advanced during final lifecycle validation; re-evaluate before resuming writers")
        self.guard(record)
        return self.save(record, "ACTIVE", completed_at=self.now(), awaiting_prs=[])

    @serialized
    def validate(self, cycle, number, head, base, evidence):
        record = self.store.load(cycle)
        self.guard(record)
        self.live()
        if record["phase"] != "WAITING_VALIDATION" or not evidence.strip():
            raise Hold("Validation requires a repaired waiting cycle and an explicit evidence pointer")
        item = next((q for q in record["queue"] if q["number"] == number), None)

        def verify_current():
            pr = self.pr(number)
            # PR base.sha is historical metadata; only the independent ref binds the live base.
            if (item is None or pr["state"] != "open" or pr["base"]["ref"] != self.integration or
                    not pr["base"].get("repo") or pr["base"]["repo"]["id"] != self.config["repository_id"] or
                    not pr["head"].get("repo") or pr["head"]["repo"]["id"] != item["head_repo"] or
                    pr["head"]["ref"] != item["head_ref"] or pr["head"]["sha"] != head or
                    head != item["head"] or not base or base != record["target"] or
                    self.ref(self.integration) != base):
                raise Hold("Validation must name the exact current inventoried PR head and integration base SHA")

        verify_current()
        actor = self.api.request("GET", "user")
        if actor.get("type") != "User":
            raise Hold("Manual validation evidence requires an operator user identity")
        verify_current()
        self.guard(record)
        record["validations"][str(number)] = {"head": head, "base": base, "evidence": evidence,
                                                "operator": actor["login"], "at": self.now()}
        return self.save(record)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="Permit explicitly requested remote and journal writes")
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze")
    analyze.add_argument("--head", required=True)
    analyze.add_argument("--base", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--cycle", required=True)
    prepare.add_argument("--pr", type=int, required=True)
    prepare.add_argument("--head", required=True)
    prepare.add_argument("--base", required=True)
    prepare.add_argument("--writers-paused", action="store_true", help="Acknowledge BOTH integration and main writer coordination")
    prepare.add_argument("--queue-edits-paused", action="store_true", help="Separately acknowledge affected PR admission/base/head edit coordination")
    prepare.add_argument("--lease-seconds", type=int, default=1800)
    promote = commands.add_parser("promote")
    promote.add_argument("--cycle", required=True)
    promote.add_argument("--approval", choices=("human-required", "enforced-auto"), required=True)
    merge = commands.add_parser("merge")
    merge.add_argument("--cycle", required=True)
    merge.add_argument("--human-approval", action="store_true")
    reconcile = commands.add_parser("reconcile")
    reconcile.add_argument("--cycle")
    reconcile.add_argument("--event-file", type=Path)
    validate = commands.add_parser("validate")
    validate.add_argument("--cycle", required=True)
    validate.add_argument("--pr", type=int, required=True)
    validate.add_argument("--head", required=True)
    validate.add_argument("--base", required=True)
    validate.add_argument("--evidence", required=True, help="Pointer to freshly reviewed base/head verification, not a claim that this CLI ran CI")
    commands.add_parser("status")
    args = parser.parse_args(argv)
    try:
        config = validate_config(json.loads(args.config.read_text()))
        controller = Controller(GitHub(), config, Store(Path(config["state_dir"])))
        if args.command == "status":
            controller.live()
            result = controller.store.cycles()
        elif args.command == "analyze":
            print(controller.analyze(args.head, args.base))
            return 0
        elif not args.apply:
            controller.live()
            result = {"dry_run": True, "command": args.command,
                      "note": "No remote/journal writes. Add --apply only under the approved policy and writer coordination."}
        elif args.command == "prepare":
            result = controller.prepare(args.cycle, args.pr, args.head, args.base, args.writers_paused,
                                        args.lease_seconds, args.queue_edits_paused)
        elif args.command == "promote":
            result = controller.promote(args.cycle, args.approval)
        elif args.command == "merge":
            result = controller.merge(args.cycle, args.human_approval)
        elif args.command == "reconcile":
            if args.event_file:
                event = json.loads(args.event_file.read_text())
                if event.get("repository", {}).get("id") != config["repository_id"]:
                    raise Hold("Wakeup event does not belong to the pinned repository")
            result = controller.reconcile(args.cycle)
        else:
            result = controller.validate(args.cycle, args.pr, args.head, args.base, args.evidence)
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except (Hold, APIError, ValueError, OSError, KeyError) as error:
        print(json.dumps({"result": "HOLD", "reason": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
