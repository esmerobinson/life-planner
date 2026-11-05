#!/bin/bash
# Gets an open Esmeworld onto the version just installed at BUNDLE (bug #39).
#
#   mac/tell-running-app.sh BUNDLE [STATUS_FILE]
#
# Run by `mac/build.sh --install` after the swap. Never kills or quits the app: it
# posts a distributed notification, and the app (from the version with EsmeworldWebBuild
# in its Info.plist on) saves what is on its page, then reloads the page from the new
# files, or quits and reopens itself when the app part changed. While she is typing in
# it, it waits until nothing has been typed for 30 s or she switches to another app.
# The app writes what it runs to STATUS_FILE (default: its running-build.json), read
# back here to say plainly whether it was updated. Always exits 0: the install itself
# has already succeeded.
#
# ESMEWORLD_TELL_WAIT: seconds to wait for an answer (default 45).

set -uo pipefail

BUNDLE="${1:?usage: tell-running-app.sh BUNDLE [STATUS_FILE]}"
STATUS_FILE="${2:-$HOME/Library/Application Support/Esmeworld/running-build.json}"
WAIT="${ESMEWORLD_TELL_WAIT:-45}"
EXE="$BUNDLE/Contents/MacOS/Esmeworld"

NEW_WEB="$(plutil -extract EsmeworldWebBuild raw "$BUNDLE/Contents/Info.plist" 2>/dev/null || true)"
NEW_SHELL="$(plutil -extract EsmeworldShellBuild raw "$BUNDLE/Contents/Info.plist" 2>/dev/null || true)"

# Processes running this bundle's executable (by path; the self-test's build lives elsewhere).
running_pids() {
    local pid cmd
    ps -axo pid=,command= | while read -r pid cmd; do
        if [[ "$cmd" == "$EXE" || "$cmd" == "$EXE "* ]]; then echo "$pid"; fi
    done
    return 0
}
status_field() { plutil -extract "$1" raw "$STATUS_FILE" 2>/dev/null || true; }

PIDS="$(running_pids)"
if [[ -z "$PIDS" ]]; then
    echo "Esmeworld is not open. It uses the new version the next time it is opened."
    exit 0
fi
if [[ -z "$NEW_WEB" || -z "$NEW_SHELL" ]]; then
    echo "warning: $BUNDLE/Contents/Info.plist has no build ids; can't tell the open Esmeworld" >&2
    exit 0
fi

echo "Esmeworld is open (pid $(echo $PIDS)): telling it about the new version"
osascript -l JavaScript -e 'function run(argv) {
    ObjC.import("Foundation");
    $.NSDistributedNotificationCenter.defaultCenter
        .postNotificationNameObjectUserInfoDeliverImmediately(
            "world.esme.esmeworld.newVersionInstalled", argv[0], $(), true);
}' "$BUNDLE" >/dev/null || echo "note: could not send the notification; it also looks every 2 minutes"

RESULT="none"
for _ in $(seq 1 "$WAIT"); do
    sleep 1
    spid="$(status_field pid)"
    [[ -n "$spid" ]] && running_pids | grep -qx "$spid" || continue
    if [[ "$(status_field state)" == current && "$(status_field web)" == "$NEW_WEB" \
          && "$(status_field shell)" == "$NEW_SHELL" ]]; then
        RESULT="updated"
        break
    fi
    if [[ "$(status_field state)" == waiting && "$(status_field diskWeb)" == "$NEW_WEB" ]]; then
        RESULT="waiting"
    fi
done

case "$RESULT" in
    updated)
        echo "UPDATED: the open Esmeworld (pid $(status_field pid)) now runs the new version."
        echo "It saved her page first, then reloaded it (or reopened itself)."
        ;;
    waiting)
        echo "WAITING: the open Esmeworld has seen the new version and changes over by itself"
        echo "once nothing has been typed in it for 30 seconds, or when she switches to another"
        echo "app. It saves her page first. (It says: $(status_field reason))"
        ;;
    *)
        for pid in $PIDS; do
            echo "NOT UPDATED: the open Esmeworld (pid $pid, opened $(ps -o lstart= -p "$pid" 2>/dev/null | sed 's/^ *//; s/ *$//'))"
        done
        echo "is an older version that can't update itself, or it did not answer."
        echo "Ask Esme to stop typing for a few seconds, then quit Esmeworld (Esmeworld menu >"
        echo "Quit, or Cmd+Q) and open it again. Versions from this one on update themselves."
        ;;
esac
exit 0
