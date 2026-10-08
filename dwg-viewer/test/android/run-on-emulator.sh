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
WV=$(adb shell dumpsys package com.google.android.webview 2>/dev/null | grep -m1 versionName | tr -d ' \r')
[ -z "$WV" ] && WV=$(adb shell dumpsys package com.android.webview 2>/dev/null | grep -m1 versionName | tr -d ' \r')
echo "WebView: $WV" | tee "$OUT/webview.txt"
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
  if wait_text "$NAME" 60; then echo "drawing received ($URI)"; else echo "drawing did NOT open"; fail=1; fi
  # wait for the DWG decoder (WebAssembly) to finish
  done_ok=0
  for i in $(seq 1 90); do
    ui > "$OUT/ui.xml"
    if ! grep -qE "Reading |Preparing drawing|Opening " "$OUT/ui.xml"; then done_ok=1; break; fi
    sleep 1
  done
  if [ $done_ok = 1 ]; then echo "DWG decoded and displayed"; else echo "DWG still loading after 90 s"; fail=1; fi
  echo "screen texts:"; grep -o 'text="[^"]*"' "$OUT/ui.xml" | sort -u | head -40
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
  XY=$(python3 - "$OUT/ui.xml" <<'PY'
import re, sys
xml = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
for node in re.findall(r'<node [^>]*>', xml):
    if 'Open sample drawing' in node:
        m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
        if m:
            a, b, c, d = map(int, m.groups()); print((a + c) // 2, (b + d) // 2); break
PY
)
  if [ -n "$XY" ]; then
    adb shell input tap $XY
    if wait_text "sample-house.dxf" 40; then echo "sample opened OK"; else echo "sample did NOT open"; fail=1; fi
    sleep 3
    shot 3-sample
  fi
fi

adb shell pidof $PKG >/dev/null && echo "app still running" || { echo "app CRASHED"; fail=1; }
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
if grep -qE "FATAL EXCEPTION" "$OUT/logcat.txt"; then grep -E -A15 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -40; fail=1; fi
grep -iE "Capacitor/Console|chromium.*(Uncaught|Error)|DWGViewer" "$OUT/logcat.txt" | tail -30
echo "result: $([ $fail = 0 ] && echo PASS || echo FAIL)" | tee "$OUT/result.txt"
exit $fail
