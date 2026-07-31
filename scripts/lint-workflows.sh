#!/usr/bin/env bash
set -euo pipefail

command -v actionlint >/dev/null
command -v shellcheck >/dev/null
actionlint
shellcheck scripts/lint-workflows.sh
