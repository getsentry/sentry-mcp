#!/bin/bash
### Example of a version-bumping script for an NPM project.
### Located at: ./bin/bump-version.sh
set -eux
OLD_VERSION="${1}"
NEW_VERSION="${2}"

# Do not tag and commit changes made by "npm version"
export npm_config_git_tag_version=false
pnpm -r exec npm version "${NEW_VERSION}"
