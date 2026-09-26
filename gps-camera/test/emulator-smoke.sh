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
  echo "--- install / start output ---"
  cat "$OUT/install.txt" "$OUT/start.txt" 2>/dev/null
  adb shell pm list packages 2>/dev/null | grep -i sarathi || echo "(package not installed)"
  echo "--- foreground window ---"
  adb shell dumpsys window windows 2>/dev/null | grep -E "mCurrentFocus|mFocusedApp" | head -5
  echo "--- views on screen ---"
  [ -f "$OUT/ui.xml" ] && grep -o 'resource-id="[^"]*"\|text="[^"]\+"' "$OUT/ui.xml" | head -40
  echo "--- app log / crashes ---"
  adb logcat -d > "$OUT/logcat.txt" 2>&1
  grep -E -A 25 "FATAL EXCEPTION|AndroidRuntime" "$OUT/logcat.txt" | head -80
  grep -E "SarathiCam" "$OUT/logcat.txt" | tail -40
  grep -iE "gpscamera|CameraX|Camera2CameraImpl" "$OUT/logcat.txt" | grep -v "java.lang.Throwable\|\tat " | tail -25
}
fail() { echo "FAIL: $*" | tee "$OUT/result.txt"; diag; exit 1; }

adb wait-for-device
adb shell input keyevent 82 || true
# "-g" (grant all permissions) only exists on Android 6+; Android 5 prints an error but exits 0,
# so check that the package really got installed and retry without it.
installed() { adb shell pm list packages 2>/dev/null | tr -d '\r' | grep -qx "package:$PKG"; }
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1 || true
installed || adb install -r "$APK" >> "$OUT/install.txt" 2>&1 || true
installed || fail "install"
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

# Emulator system apps sometimes crash on boot and leave a "System UI has stopped" dialog on
# top that swallows input. Suppress/close those, bring our activity to the front and press the
# shutter; retry up to three times.
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
shoot() {
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
  adb shell am start -n $PKG/.MainActivity >/dev/null 2>&1 || true
  sleep 3
  BOUNDS=""
  if adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1 \
     && adb pull /data/local/tmp/ui.xml "$OUT/ui.xml" >/dev/null 2>&1; then
    if grep -q 'android:id/aerr_close' "$OUT/ui.xml"; then
      B=$(grep -o 'resource-id="android:id/aerr_close"[^>]*bounds="[^"]*"' "$OUT/ui.xml" | grep -o 'bounds="[^"]*"' | head -1)
      read -r X1 Y1 X2 Y2 <<<"$(echo "$B" | tr -c '0-9' ' ')"
      echo "Closing a system error dialog"
      adb shell input tap $(( (X1 + X2) / 2 )) $(( (Y1 + Y2) / 2 ))
      sleep 2
      adb shell uiautomator dump /data/local/tmp/ui.xml >/dev/null 2>&1 && adb pull /data/local/tmp/ui.xml "$OUT/ui.xml" >/dev/null 2>&1
    fi
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
}

FOUND=""
for attempt in 1 2 3; do
  shoot
  for i in $(seq 1 15); do
    sleep 2
    FOUND=$(adb shell "ls /sdcard/Pictures/ProjectSarathi/ 2>/dev/null" | tr -d '\r' | grep -m1 '\.jpg$' || true)
    [ -n "$FOUND" ] && break
  done
  [ -n "$FOUND" ] && break
  echo "Attempt $attempt: no photo yet; focus is $(adb shell dumpsys window windows 2>/dev/null | grep -m1 mCurrentFocus)"
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
