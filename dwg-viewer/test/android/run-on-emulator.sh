#!/usr/bin/env bash
# Installs the APK on a running emulator, opens the app and a DWG file through an
# "Open with" (VIEW) intent, and checks the UI via the accessibility tree.
# Usage: run-on-emulator.sh <apk> <drawing.dwg> <outDir>
set -u
APK="$1"; DWG="$2"; OUT="$3"
PKG=com.dwgviewer.app
mkdir -p "$OUT"
fail=0
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }
ui() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml 2>/dev/null; }
wait_text() { # wait_text <text> <seconds>
  for i in $(seq 1 "$2"); do ui > "$OUT/ui.xml"; if grep -q "$1" "$OUT/ui.xml"; then return 0; fi; sleep 1; done; return 1;
}

adb wait-for-device
adb shell settings put global window_animation_scale 0 || true
adb install -r "$APK" | tee "$OUT/install.txt"
adb logcat -c || true

echo "== launch"
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
if wait_text "Open drawing" 60; then echo "home screen OK"; else echo "home screen NOT found"; fail=1; fi
shot 1-home

echo "== open a DWG via VIEW intent"
NAME=$(basename "$DWG")
adb push "$DWG" "/sdcard/Download/$NAME" >/dev/null
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$NAME" >/dev/null 2>&1 || true
sleep 3
ID=$(adb shell content query --uri content://media/external/file --projection _id --where "_display_name=\'$NAME\'" 2>/dev/null | grep -o '_id=[0-9]*' | head -1 | cut -d= -f2)
if [ -n "$ID" ]; then
  URI="content://media/external/file/$ID"
  adb shell am start -a android.intent.action.VIEW -d "$URI" -t image/vnd.dwg -n $PKG/.MainActivity --grant-read-uri-permission
  if wait_text "$NAME" 60; then echo "drawing opened OK ($URI)"; else echo "drawing did NOT open"; fail=1; fi
  sleep 3
  shot 2-drawing
  if grep -q "Can.t open" "$OUT/ui.xml"; then echo "error dialog shown"; fail=1; fi
else
  echo "could not find the file in MediaStore; skipping intent test"
fi

echo "== sample drawing from the home screen"
adb shell input keyevent KEYCODE_BACK
sleep 2
if wait_text "Open sample drawing" 20; then
  # tap the sample button using its bounds from the UI dump
  B=$(grep -o 'text="Open sample drawing"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' "$OUT/ui.xml" | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | tr -d '[]' | tr ',' ' ')
  if [ -n "$B" ]; then
    set -- $B
    adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
    if wait_text "sample-house.dxf" 40; then echo "sample opened OK"; else echo "sample did NOT open"; fail=1; fi
    sleep 3
    shot 3-sample
  fi
fi

adb shell pidof $PKG >/dev/null && echo "app still running" || { echo "app CRASHED"; fail=1; }
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
if grep -qE "FATAL EXCEPTION" "$OUT/logcat.txt"; then grep -E -A15 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -40; fail=1; fi
grep -iE "chromium.*(Uncaught|Error)" "$OUT/logcat.txt" | head -20
echo "result: $([ $fail = 0 ] && echo PASS || echo FAIL)" | tee "$OUT/result.txt"
exit $fail
