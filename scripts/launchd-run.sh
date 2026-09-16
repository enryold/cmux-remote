#!/bin/sh

set -u

child=
stop() {
  trap - TERM INT
  if [ -n "$child" ]; then
    kill "$child" 2>/dev/null || :
    wait "$child" 2>/dev/null || :
  fi
  exit 0
}
trap stop TERM INT

attempt=0
delay=2
while :; do
  "$@" &
  child=$!
  wait "$child"
  status=$?
  child=
  [ "$status" -eq 0 ] && exit 0
  [ "$attempt" -ge 3 ] && exit "$status"

  attempt=$((attempt + 1))
  sleep "$delay" &
  child=$!
  wait "$child" || exit 0
  child=
  delay=$((delay * 2))
done
