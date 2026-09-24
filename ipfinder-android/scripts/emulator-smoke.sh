#!/usr/bin/env bash
# Installs the APK on a running emulator, runs a real scan, opens every screen and monkey-tests the UI.
# Fails if the app crashes or the scan finds nothing. Usage: emulator-smoke.sh <apk> <label>
set -uo pipefail
APK="$1"
LABEL="${2:-emulator}"
PKG=com.ahuva.ipfinder
OUT="smoke-$LABEL"
mkdir -p "$OUT"

dump() { # dump <name>: screenshot + visible texts
  sleep "${2:-6}"
  adb shell screencap -p "/sdcard/$1.png" && adb pull "/sdcard/$1.png" "$OUT/$1.png" >/dev/null
  adb shell uiautomator dump "/sdcard/$1.xml" >/dev/null 2>&1
  adb pull "/sdcard/$1.xml" "$OUT/$1.xml" >/dev/null 2>&1 || true
  echo "---- $1 ----"
  grep -o 'text="[^"]\+"' "$OUT/$1.xml" 2>/dev/null | sed 's/^text=//' | head -40 || true
}

crashed() {
  adb logcat -d -b crash > "$OUT/crash.log" 2>/dev/null || true
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
  grep -q "FATAL EXCEPTION" "$OUT/logcat.txt" "$OUT/crash.log" 2>/dev/null
}

adb wait-for-device
adb install -r -g "$APK" || adb install -r "$APK" || exit 1
adb logcat -c || true

adb shell am start -W -n "$PKG/.ui.MainActivity" --ez autoscan true --es range 10.0.2.0/24
dump main-scanning 4
# Wait for the scan to finish (the status line says "devices online").
for i in $(seq 1 30); do
  adb shell uiautomator dump /sdcard/s.xml >/dev/null 2>&1
  if adb shell cat /sdcard/s.xml 2>/dev/null | grep -q "devices online"; then break; fi
  sleep 3
done
dump main-done 1
grep -q "devices online" "$OUT/main-done.xml" || { echo "::error::scan did not complete"; crashed; exit 1; }
grep -Eq 'text="10\.0\.2\.[0-9]{1,3}("|  )' "$OUT/main-done.xml" || { echo "::error::scan found no emulator hosts"; exit 1; }

# Non-exported screens: start them as root (google_apis images allow adb root).
adb root >/dev/null 2>&1; sleep 3; adb wait-for-device
adb shell am start -W -n "$PKG/.ui.DeviceActivity" --es ip 10.0.2.2 && dump device-gateway 8
adb shell am start -W -n "$PKG/.ui.ToolsActivity" --es tool ping --es host 10.0.2.2 && dump tools-ping 3
adb shell am start -W -n "$PKG/.ui.ToolsActivity" --es tool ports --es host 10.0.2.2 && dump tools-ports 3
adb shell am start -W -n "$PKG/.ui.ToolsActivity" --es tool netinfo && dump tools-netinfo 4
adb shell am start -W -n "$PKG/.ui.ToolsActivity" --es tool subnet && dump tools-subnet 3
adb shell am start -W -n "$PKG/.ui.ToolsActivity" --es tool wol && dump tools-wol 3
adb shell am start -W -n "$PKG/.ui.ToolsActivity" --es tool trace --es host 10.0.2.2 && dump tools-trace 3
adb shell am start -W -n "$PKG/.ui.SettingsActivity" && dump settings 3
adb shell am start -W -n "$PKG/.ui.MainActivity" && dump main-again 3

# Rotation and theme recreation.
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1; sleep 3
adb shell settings put system user_rotation 0; sleep 3

# Random UI exercise (touches, menus, back). Monkey exits non-zero on a crash or ANR.
adb shell monkey -p "$PKG" --pct-syskeys 0 --pct-appswitch 0 --throttle 120 -s 42 -v 600 > "$OUT/monkey.txt" 2>&1
MONKEY=$?
tail -5 "$OUT/monkey.txt"

if crashed; then
  echo "::error::App crashed on $LABEL"
  grep -A 30 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -60
  exit 1
fi
if [ "$MONKEY" -ne 0 ] && grep -qE "CRASH|NOT RESPONDING" "$OUT/monkey.txt"; then
  echo "::error::Monkey found a crash/ANR on $LABEL"
  grep -B 2 -A 30 -E "CRASH|NOT RESPONDING" "$OUT/monkey.txt" | head -60
  exit 1
fi
echo "Smoke test passed on $LABEL"
