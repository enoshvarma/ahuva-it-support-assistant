package com.projectsarathi.gpscamera;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.util.LruCache;

import java.util.Locale;

/**
 * Builds a small map image centred on a coordinate from OpenStreetMap tiles. Blocking — call
 * from a worker thread. Returns null when offline so the stamp falls back to a plain map card.
 */
public final class MapTileLoader {

    private static final int TILE = 256;
    private static final int ZOOM = 16;

    private final LruCache<String, Bitmap> tiles = new LruCache<>(16);

    public Bitmap render(double lat, double lng) {
        double n = Math.pow(2, ZOOM) * TILE;
        double px = (lng + 180.0) / 360.0 * n;
        double latRad = Math.toRadians(Math.max(-85.0511, Math.min(85.0511, lat)));
        double py = (1.0 - Math.log(Math.tan(latRad) + 1.0 / Math.cos(latRad)) / Math.PI) / 2.0 * n;

        int size = TILE;
        int left = (int) Math.round(px) - size / 2;
        int top = (int) Math.round(py) - size / 2;
        int max = (1 << ZOOM);

        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        c.drawColor(Color.rgb(0xE8, 0xE4, 0xDC));
        int loaded = 0;
        for (int tx = floorDiv(left, TILE); tx <= floorDiv(left + size - 1, TILE); tx++) {
            for (int ty = floorDiv(top, TILE); ty <= floorDiv(top + size - 1, TILE); ty++) {
                if (ty < 0 || ty >= max) continue;
                int wx = ((tx % max) + max) % max;
                Bitmap t = tile(wx, ty);
                if (t != null) {
                    c.drawBitmap(t, tx * TILE - left, ty * TILE - top, null);
                    loaded++;
                }
            }
        }
        if (loaded == 0) {
            out.recycle();
            return null;
        }
        return out;
    }

    private static int floorDiv(int a, int b) {
        int q = a / b;
        if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
        return q;
    }

    private Bitmap tile(int x, int y) {
        String key = x + "/" + y;
        Bitmap b = tiles.get(key);
        if (b != null) return b;
        try {
            byte[] data = AddressLookup.httpGetBytes(String.format(Locale.US,
                    "https://tile.openstreetmap.org/%d/%d/%d.png", ZOOM, x, y));
            b = BitmapFactory.decodeByteArray(data, 0, data.length);
            if (b != null) tiles.put(key, b);
            return b;
        } catch (Throwable e) {
            return null;
        }
    }
}
