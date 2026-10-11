#!/usr/bin/env bash
# Builds every workspace and links the ez4 CLI once per CI job.
#
# The full suite runs lint and every test leg one after another in a single job, and each of them needs the whole
# build. The marker lives in the runner's temp directory, so the next leg of the same job skips straight to its
# command and a new job builds again. Outside CI (no RUNNER_TEMP) it always builds.
set -euo pipefail

marker="${RUNNER_TEMP:+$RUNNER_TEMP/ez4-build-done}"

if [ -n "$marker" ] && [ -f "$marker" ]; then
  exit 0
fi

npm run build
npm link -w @ez4/project --prefer-offline --no-audit

if [ -n "$marker" ]; then
  touch "$marker"
fi
