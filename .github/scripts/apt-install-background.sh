#!/usr/bin/env bash
# Installs Ubuntu packages in the background so the job can keep working.
#
#   apt-install-background.sh start <package>...  starts the install and returns
#   apt-install-background.sh wait [seconds]       waits for it, prints its log
#
# Every apt call is bounded: a stalled mirror fails over or retries instead of
# hanging until the job times out, and a timeout prints the log and the apt
# processes still running so the cause is visible.
set -euo pipefail

status="$RUNNER_TEMP/apt-status"
log="$RUNNER_TEMP/apt.log"

apt_options=(
  -o Acquire::Retries=3
  -o Acquire::http::Timeout=30
  -o Acquire::https::Timeout=30
  -o DPkg::Lock::Timeout=120
)

install() {
  local attempt
  for attempt in 1 2 3; do
    echo "== apt-get update (attempt $attempt)"
    if sudo timeout 120 apt-get "${apt_options[@]}" update; then
      echo "== apt-get install $*"
      sudo apt-get "${apt_options[@]}" install -y "$@" && return 0
    fi
    echo "== attempt $attempt failed"
    sleep 5
  done
  return 1
}

case "${1:-}" in
  start)
    shift
    rm -f "$status"
    (
      set +e
      install "$@"
      echo "$?" > "$status"
    ) > "$log" 2>&1 < /dev/null &
    ;;
  wait)
    deadline=$((SECONDS + ${2:-600}))
    until test -s "$status"; do
      if ((SECONDS >= deadline)); then
        cat "$log" || true
        echo "== apt processes still running"
        # shellcheck disable=SC2009 # pgrep cannot show elapsed time and arguments.
        ps -eo pid,etimes,args | grep -E '[a]pt-get|/usr/lib/[a]pt/|[d]pkg' || true
        echo "::error::apt did not finish installing packages in time; its log is above."
        exit 1
      fi
      sleep 1
    done
    cat "$log"
    code="$(cat "$status")"
    if [ "$code" != 0 ]; then
      echo "::error::apt failed to install packages (exit $code); its log is above."
    fi
    exit "$code"
    ;;
  *)
    echo "usage: $0 start <package>... | wait [seconds]" >&2
    exit 2
    ;;
esac
