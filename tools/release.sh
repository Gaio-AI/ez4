#!/usr/bin/env bash
# Publishes every public workspace at its current version, skipping the ones already in the
# registry so a failed run can simply be run again.
set -euo pipefail

version=$(node -p "require('./foundation/utils/package.json').version")

npm run clean
npm run build

node -e '
  const { execSync } = require("node:child_process");
  const workspaces = JSON.parse(execSync("npm query .workspace", { encoding: "utf8" }));
  for (const { name, private: isPrivate } of workspaces) if (!isPrivate) console.log(name);
' | while read -r name; do
  if npm view "$name@$version" version >/dev/null 2>&1; then
    echo "$name@$version already published"
  else
    npm publish --workspace "$name" --access public
  fi
done
