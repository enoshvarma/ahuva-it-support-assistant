# Project Sarathi GPS Camera (Android)

A native Android camera that stamps every photo with a **PROJECT SARATHI** GPS overlay. You see
the overlay live in the viewfinder, and the same overlay is burned into the saved JPEG:

- Map thumbnail with a location pin (OpenStreetMap)
- Place name (city, state, country) and full street address
- Latitude / longitude (6 decimals) and Plus Code
- Date, time and GMT offset
- Altitude and GPS accuracy
- Optional note (for example "Site inspection – Block A")

Photos go to **Pictures/ProjectSarathi**. They also carry standard GPS EXIF tags, so Google Photos
and other gallery apps show them on a map.

## Features

- Flash off / auto / on, front and back camera, 1x / 2x / 5x zoom, pinch-zoom, tap-to-focus
- Settings button: change the project name, add a note, hide or show the map
- Share button: sends the last photo plus a Google Maps link
- Uses the phone's own GPS and network location, with no Google Play Services needed. It works on
  phones without Google apps.
- Offline-safe. With no internet, the map card shows a plain grid and the address is left out.
  Coordinates, Plus Code and time are always stamped.

## Compatibility

`minSdk 21`, `targetSdk 35`: **Android 5.0 Lollipop through Android 15 and newer.** CI installs the
APK on Android 5.0, 8.0, 11 and 15 emulators, feeds a GPS fix, presses the shutter and checks a
stamped photo was saved. Each run uploads the resulting photos as artifacts.

## Download / build

- **CI:** open the latest *Build Sarathi GPS Camera APK* run under the repo's Actions tab and
  download the `sarathi-gps-camera` artifact. It contains `sarathi-gps-camera.apk`.
- **Local:** `cd gps-camera && ./gradlew assembleRelease` (needs the Android SDK). The APK is at
  `app/build/outputs/apk/release/app-release.apk`.

The release is signed with the bundled `app/sarathi-ci.keystore`, which is fine for sideloading.
For Google Play, add the `SARATHI_KEYSTORE_BASE64` and `SARATHI_KEYSTORE_PASSWORD` repository
secrets so CI signs with your own private key.

## Code map

| File | What it does |
|---|---|
| `MainActivity.java` | CameraX preview/capture, permissions, controls, settings |
| `StampRenderer.java` | Draws the stamp, shared by the live overlay and the saved photo |
| `LocationTracker.java` | GPS + network location via `LocationManager` |
| `AddressLookup.java` | Reverse geocoding: phone Geocoder, then OpenStreetMap Nominatim |
| `MapTileLoader.java` | Builds the map thumbnail from OpenStreetMap tiles |
| `PlusCode.java` | Open Location Code encoder |
| `PhotoSaver.java` | Rotates, stamps, writes EXIF and saves to the gallery on every Android version |
