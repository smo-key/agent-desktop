#!/bin/sh
# Runs every *_test.sh in this directory and reports a combined total.
# Usage: sh docs/tests/run.sh
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

total_run=0
total_failed=0
status=0

for t in "$here"/*_test.sh; do
  [ -e "$t" ] || continue
  printf '\n# %s\n' "$(basename "$t")"
  # Each test file runs in its own subshell with the assertion lib loaded,
  # and prints "RUN <n> FAILED <n>" on its last line for the parent to tally.
  result=$(
    # shellcheck disable=SC1090
    . "$here/lib.sh"
    HERE=$here
    export HERE
    # shellcheck disable=SC1090
    . "$t"
    printf 'RUN %s FAILED %s\n' "$TESTS_RUN" "$TESTS_FAILED"
  ) || status=1
  # Echo everything except the trailing tally line, then parse the tally.
  printf '%s\n' "$result" | grep -v '^RUN [0-9]* FAILED [0-9]*$' || true
  tally=$(printf '%s\n' "$result" | grep '^RUN [0-9]* FAILED [0-9]*$' | tail -n1)
  r=$(printf '%s' "$tally" | awk '{print $2}')
  f=$(printf '%s' "$tally" | awk '{print $4}')
  total_run=$((total_run + ${r:-0}))
  total_failed=$((total_failed + ${f:-0}))
done

printf '\n----\nTotal: %s run, %s failed\n' "$total_run" "$total_failed"
[ "$total_failed" -eq 0 ] && [ "$status" -eq 0 ] || exit 1
