package com.projectsarathi.gpscamera;

import android.graphics.Bitmap;

/** Everything printed on the photo stamp. Immutable snapshot, safe to hand to a worker thread. */
public final class StampData {

    public final String projectName;
    public final String title;        // e.g. "Hyderabad, Telangana, India"
    public final String address;      // full street address, may be empty
    public final boolean hasFix;
    public final double latitude;
    public final double longitude;
    public final double altitude;     // metres, NaN if unknown
    public final float accuracy;      // metres, NaN if unknown
    public final long timeMillis;
    public final String note;         // may be empty
    public final Bitmap map;          // may be null
    public final boolean showMap;

    public StampData(String projectName, String title, String address, boolean hasFix,
                     double latitude, double longitude, double altitude, float accuracy,
                     long timeMillis, String note, Bitmap map, boolean showMap) {
        this.projectName = projectName;
        this.title = title;
        this.address = address;
        this.hasFix = hasFix;
        this.latitude = latitude;
        this.longitude = longitude;
        this.altitude = altitude;
        this.accuracy = accuracy;
        this.timeMillis = timeMillis;
        this.note = note;
        this.map = map;
        this.showMap = showMap;
    }

    public StampData withTime(long millis) {
        return new StampData(projectName, title, address, hasFix, latitude, longitude,
                altitude, accuracy, millis, note, map, showMap);
    }
}
