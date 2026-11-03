#!/usr/bin/env python3
"""Verify the persistent deployment, then delegate reconciliation to the shared controller."""

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True


def protected_path(value, workspace, directory=False):
    candidate = Path(value)
    if not candidate.is_absolute() or candidate.is_symlink():
        raise ValueError("Deployment paths must be absolute and must not be symlinks")
    if candidate.resolve().is_relative_to(workspace):
        raise ValueError("Persistent deployment must be outside the checkout")
    metadata = candidate.stat()
    if metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise ValueError("Deployment files and directories must be operator-owned and private")
    valid_type = candidate.is_dir() if directory else candidate.is_file()
    if not valid_type:
        raise ValueError("Deployment path has an unexpected type")
    return candidate


def inspect(args):
    workspace = Path(__file__).resolve().parents[1]
    policy_path = protected_path(args.config, workspace)
    controller = protected_path(args.controller, workspace)
    provenance = json.loads(args.provenance.read_text())
    if provenance.get("source_repository") != "RbBtSn0w/apple-skills":
        raise ValueError("Unexpected controller source repository")
    if hashlib.sha256(controller.read_bytes()).hexdigest() != provenance.get("sha256"):
        raise ValueError("Deployed controller digest does not match the reviewed provenance")
    config = json.loads(policy_path.read_text())
    if (config.get("repository"), config.get("repository_id"), config.get("mode"), config.get("sync_strategy")) != (
        "RbBtSn0w/wechat-publisher", 1174169063, "retained", "reviewed-pr"
    ):
        raise ValueError("Policy does not match the approved repository and synchronization strategy")
    state = protected_path(config["state_dir"], workspace, directory=True)
    spec = importlib.util.spec_from_file_location("approved_release_train", controller)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.validate_config(config)
    records = module.Store(state).cycles()
    if args.event_file:
        event = json.loads(args.event_file.read_text())
        if event.get("repository", {}).get("id") != config["repository_id"]:
            raise ValueError("Wakeup event does not belong to the approved repository")
    return controller, policy_path, {
        "result": "STAGED",
        "source_commit": provenance["source_commit"],
        "controller_sha256": provenance["sha256"],
        "credential_present": bool(os.environ.get("GH_TOKEN")),
        "cycle_count": len(records),
        "cycles": [{"cycle": record["cycle"], "phase": record["phase"]} for record in records],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--controller", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--event-file", type=Path)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true")
    action.add_argument("--reconcile", action="store_true")
    args = parser.parse_args()
    try:
        controller, policy, result = inspect(args)
        if args.check:
            print(json.dumps(result, sort_keys=True, indent=2))
            return 0
        if not os.environ.get("GH_TOKEN"):
            raise ValueError("An explicit repository-scoped GH_TOKEN is required")
        command = [sys.executable, str(controller), "--config", str(policy), "--apply", "reconcile"]
        if args.event_file:
            command += ["--event-file", str(args.event_file)]
        return subprocess.run(command, check=False).returncode
    except (ValueError, OSError, KeyError, RuntimeError) as error:
        print(json.dumps({"result": "HOLD", "reason": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
