#!/bin/sh
# Runs at container start: writes /servers.json from KEYFALL_SERVERS, the room servers this app offers.
#   KEYFALL_SERVERS="wss://rooms1.example.com, rooms2.example.com:7777"
# The first one is the default. Empty: the app looks for rooms on its own address.
set -eu
mkdir -p /tmp/keyfall
printf '%s' "${KEYFALL_SERVERS:-}" | awk -v RS=',' '
    { gsub(/^[[:space:]]+|[[:space:]]+$/, ""); gsub(/["\\]/, "") }
    length($0) { printf "%s\"%s\"", (n++ ? "," : "["), $0 }
    END { print (n ? "]" : "[]") }' > /tmp/keyfall/servers.json
echo "keyfall: room servers $(cat /tmp/keyfall/servers.json)"
