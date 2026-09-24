#!/usr/bin/env bash
# Runs inside the booted emulator job. Installs the published release APK and checks it starts
# cleanly, then installs the self-test build (same code + test hook) and runs every feature
# against the fixtures in servers.py / the OpenSSH container. Artifacts land in $OUT.
set -uo pipefail
OUT=${OUT:-emulator-results}
API=${API:-unknown}
mkdir -p "$OUT"
PKG=com.ahuva.itsupport

wait_for_log() { # tag pattern timeout
  local end=$((SECONDS + $3))
  while [ $SECONDS -lt $end ]; do
    if adb logcat -d -s "$1:*" | grep -q -- "$2"; then return 0; fi
    sleep 2
  done
  return 1
}

adb shell settings put global package_verifier_enable 0 >/dev/null 2>&1 || true

echo "== [API $API] release APK: install + launch"
adb install -r "$RELEASE_APK" || exit 1
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity
if wait_for_log AhuvaStatus "ready=" 90; then
  adb logcat -d -s AhuvaStatus:* | tee "$OUT/release-status.txt"
else
  echo "release APK never reported status" | tee "$OUT/release-status.txt"
fi
sleep 3
adb exec-out screencap -p > "$OUT/release-launch-api$API.png"
adb logcat -d > "$OUT/logcat-release.txt"
RELEASE_OK=0
grep -q "ready=true" "$OUT/release-status.txt" && ! grep -q "FATAL EXCEPTION" "$OUT/logcat-release.txt" && RELEASE_OK=1

echo "== [API $API] self-test build: full feature run"
adb shell am force-stop $PKG
adb install -r "$SELFTEST_APK" || exit 1
adb logcat -c
adb shell am start -W -n $PKG/.MainActivity --es selftestHost 10.0.2.2
if wait_for_log AhuvaSelfTest "SELFTEST RESULT" 420; then :; else echo "self-test timed out"; fi
sleep 2
adb logcat -d -s AhuvaSelfTest:* | tee "$OUT/selftest-api$API.txt"
adb exec-out screencap -p > "$OUT/selftest-api$API.png"
adb logcat -d > "$OUT/logcat-selftest.txt"

SELFTEST_OK=0
grep -q "SELFTEST RESULT PASS" "$OUT/selftest-api$API.txt" && ! grep -q "FATAL EXCEPTION" "$OUT/logcat-selftest.txt" && SELFTEST_OK=1

echo "release launch ok: $RELEASE_OK   self-test ok: $SELFTEST_OK"
[ $RELEASE_OK -eq 1 ] && [ $SELFTEST_OK -eq 1 ]
