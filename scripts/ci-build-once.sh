#!/usr/bin/env bash
# Builds every workspace and links the ez4 CLI once per CI job.
#
# The full suite runs lint and every test leg in a single job, several at a time, and each of them needs the whole
# build. The marker lives in the runner's temp directory, so a later leg of the same job skips straight to its
# command and a new job builds again; the lock makes the legs that start together wait for the one build instead
# of building over each other. Outside CI (no RUNNER_TEMP) it always builds.
set -euo pipefail

marker="${RUNNER_TEMP:+$RUNNER_TEMP/ez4-build-done}"

if [ -n "$marker" ]; then
  exec 9> "$RUNNER_TEMP/ez4-build.lock"
  flock 9

  if [ -f "$marker" ]; then
    exit 0
  fi
fi

npm run build
npm link -w @ez4/project --prefer-offline --no-audit

if [ -n "$marker" ]; then
  touch "$marker"
fi
