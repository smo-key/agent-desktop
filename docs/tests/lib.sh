# Minimal POSIX-sh test assertions for the installer.
# Sourced by *_test.sh files; tallies into TESTS_RUN / TESTS_FAILED.

TESTS_RUN=0
TESTS_FAILED=0

# assert_eq ACTUAL EXPECTED NAME
assert_eq() {
  TESTS_RUN=$((TESTS_RUN + 1))
  if [ "$1" = "$2" ]; then
    printf '  ok   %s\n' "$3"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf '  FAIL %s\n       expected: [%s]\n       actual:   [%s]\n' "$3" "$2" "$1"
  fi
}

# assert_ok NAME -- CMD...   (expects CMD to exit 0)
assert_ok() {
  name=$1
  shift
  [ "$1" = "--" ] && shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@" >/dev/null 2>&1; then
    printf '  ok   %s\n' "$name"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf '  FAIL %s (exit %s)\n' "$name" "$?"
  fi
}

# assert_fail NAME -- CMD...   (expects CMD to exit non-zero)
assert_fail() {
  name=$1
  shift
  [ "$1" = "--" ] && shift
  TESTS_RUN=$((TESTS_RUN + 1))
  if "$@" >/dev/null 2>&1; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    printf '  FAIL %s (expected non-zero exit, got 0)\n' "$name"
  else
    printf '  ok   %s\n' "$name"
  fi
}
