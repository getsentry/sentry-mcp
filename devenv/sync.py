from __future__ import annotations

import json
import os
import shutil

from devenv import constants
from devenv.lib import config, fs, proc


def installed_pnpm(version: str, binroot: str) -> bool:
    if shutil.which("pnpm", path=binroot) != f"{binroot}/pnpm" or not os.path.exists(
        f"{binroot}/node-env/bin/pnpm"
    ):
        return False

    stdout = proc.run((f"{binroot}/pnpm", "--version"), stdout=True)
    installed_version = stdout.strip()
    return version == installed_version


def install_pnpm(version: str, reporoot: str) -> None:
    binroot = fs.ensure_binroot(reporoot)

    if installed_pnpm(version, binroot):
        return

    print(f"installing pnpm {version}...")

    # {binroot}/npm is a devenv-managed shim, so
    # this install -g ends up putting pnpm into
    # .devenv/bin/node-env/bin/pnpm which is pointed
    # to by the {binroot}/pnpm shim
    proc.run((f"{binroot}/npm", "install", "-g", f"pnpm@{version}"), stdout=True)

    fs.write_script(
        f"{binroot}/pnpm",
        """#!/bin/sh
export PATH={binroot}/node-env/bin:"${{PATH}}"
exec {binroot}/node-env/bin/pnpm "$@"
""",
        shell_escape={"binroot": binroot},
    )


def main(context: dict[str, str]) -> int:
    reporoot = context["reporoot"]
    cfg = config.get_repo(reporoot)

    from devenv.lib import node

    node.install(
        cfg["node"]["version"],
        cfg["node"][constants.SYSTEM_MACHINE],
        cfg["node"][f"{constants.SYSTEM_MACHINE}_sha256"],
        reporoot,
    )

    with open(f"{reporoot}/package.json") as f:
        package_json = json.load(f)
        pnpm = package_json["packageManager"]
        pnpm_version = pnpm.split("@")[-1]

    # TODO: move pnpm install into devenv
    install_pnpm(pnpm_version, reporoot)

    return 0
