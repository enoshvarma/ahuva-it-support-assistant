#!/usr/bin/env bash
# Installs the release APK on the running emulator, grants permissions, feeds a GPS fix,
# takes a real photo with the shutter button and pulls the stamped JPEG back for inspection.
set -u
APK="$1"
OUT="$2"
API="$3"
PKG=com.projectsarathi.gpscamera
mkdir -p "$OUT"
diag() {
  echo "--- foreground window ---"
  adb shell dumpsys window windows 2>/dev/null | grep -E "mCurrentFocus|mFocusedApp" | head -5
  echo "--- views on screen ---"
  [ -f "$OUT/ui.xml" ] && grep -o 'resource-id="[^"]*"\|text="[^"]\+"' "$OUT/ui.xml" | head -40
  echo "--- app log / crashes ---"
  adb logcat -d > "$OUT/logcat.txt" 2>&1
  grep -E -A 25 "FATAL EXCEPTION|AndroidRuntime" "$OUT/logcat.txt" | head -80
  grep -iE "gpscamera|CameraX|Camera2CameraImpl" "$OUT/logcat.txt" | tail -40
}
fail() { echo "FAIL: $*" | tee "$OUT/result.txt"; diag; exit 1; }

adb wait-for-device
adb shell input keyevent 82 || true
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1 || adb install -r "$APK" >> "$OUT/install.txt" 2>&1 || fail "install"
for p in CAMERA ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION WRITE_EXTERNAL_STORAGE READ_EXTERNAL_STORAGE; do
  adb shell pm grant $PKG android.permission.$p >/dev/null 2>&1 || true
done

# Location on, and a fix at the Charminar, Hyderabad.
adb shell settings put secure location_providers_allowed +gps >/dev/null 2>&1 || true
adb shell settings put secure location_providers_allowed +network >/dev/null 2>&1 || true
adb shell settings put secure location_mode 3 >/dev/null 2>&1 || true
adb shell cmd location set-location-enabled true >/dev/null 2>&1 || true
geo() { adb emu geo fix 78.474444 17.361564 505 >/dev/null 2>&1 || true; }
geo

adb logcat -c
adb shell am start -W -n $PKG/.MainActivity > "$OUT/start.txt" 2>&1 || fail "launch"
for i in $(seq 1 20); do geo; sleep 2; done
adb exec-out screencap -p > "$OUT/screen-before.png" 2>/dev/null || true

# Find the shutter button in the view hierarchy and tap it. Old emulators (API 21) cannot
# dump the hierarchy, so fall back to the volume-down key, which the app also treats as a shutter.
BOUNDS=""
if adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1 \
   && adb pull /data/local/tmp/ui.xml "$OUT/ui.xml" >/dev/null 2>&1; then
  BOUNDS=$(grep -o 'resource-id="'$PKG':id/btnShutter"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' "$OUT/ui.xml" | grep -o 'bounds="[^"]*"' | head -1)
fi
if [ -n "$BOUNDS" ]; then
  read -r X1 Y1 X2 Y2 <<<"$(echo "$BOUNDS" | tr -c '0-9' ' ')"
  echo "Tapping shutter at $(( (X1 + X2) / 2 )),$(( (Y1 + Y2) / 2 ))"
  adb shell input tap $(( (X1 + X2) / 2 )) $(( (Y1 + Y2) / 2 ))
else
  echo "No view hierarchy; pressing volume-down as shutter"
  adb shell input keyevent 25
fi

FOUND=""
for i in $(seq 1 30); do
  sleep 2
  FOUND=$(adb shell "ls /sdcard/Pictures/ProjectSarathi/ 2>/dev/null" | tr -d '\r' | grep -m1 '\.jpg$' || true)
  [ -n "$FOUND" ] && break
done
adb exec-out screencap -p > "$OUT/screen-after.png" 2>/dev/null || true
adb logcat -d > "$OUT/logcat.txt" 2>&1
if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  grep -A 30 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -60
  fail "app crashed"
fi
[ -n "$FOUND" ] || fail "no photo saved in Pictures/ProjectSarathi"
adb pull "/sdcard/Pictures/ProjectSarathi/$FOUND" "$OUT/photo-api$API.jpg" >/dev/null 2>&1 || fail "pull photo"
SIZE=$(stat -c %s "$OUT/photo-api$API.jpg")
[ "$SIZE" -gt 20000 ] || fail "photo too small ($SIZE bytes)"
diag >/dev/null 2>&1 || true
echo "--- app log ---"; grep -iE "gpscamera" "$OUT/logcat.txt" | tail -15
echo "PASS: API $API saved $FOUND ($SIZE bytes)" | tee "$OUT/result.txt"
