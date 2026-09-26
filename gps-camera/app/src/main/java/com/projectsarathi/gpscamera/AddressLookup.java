package com.projectsarathi.gpscamera;

import android.content.Context;
import android.location.Address;
import android.location.Geocoder;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Locale;

/**
 * Reverse geocoding: the phone's built-in Geocoder first, then OpenStreetMap Nominatim for
 * phones that have no geocoder backend. Blocking — call from a worker thread.
 */
public final class AddressLookup {

    public static final class Result {
        public final String title;
        public final String address;

        Result(String title, String address) {
            this.title = title;
            this.address = address;
        }
    }

    private AddressLookup() {
    }

    public static Result lookup(Context context, double lat, double lng) {
        Result r = null;
        try {
            if (Geocoder.isPresent()) r = fromGeocoder(context, lat, lng);
        } catch (Throwable ignored) {
        }
        if (r == null) {
            try {
                r = fromNominatim(lat, lng);
            } catch (Throwable ignored) {
            }
        }
        return r;
    }

    @SuppressWarnings("deprecation")
    private static Result fromGeocoder(Context context, double lat, double lng) throws Exception {
        Geocoder g = new Geocoder(context, Locale.getDefault());
        List<Address> list = g.getFromLocation(lat, lng, 1);
        if (list == null || list.isEmpty()) return null;
        Address a = list.get(0);
        String city = firstNonEmpty(a.getLocality(), a.getSubAdminArea(), a.getSubLocality());
        String title = join(city, a.getAdminArea(), a.getCountryName());
        StringBuilder full = new StringBuilder();
        for (int i = 0; i <= a.getMaxAddressLineIndex(); i++) {
            String line = a.getAddressLine(i);
            if (line == null || line.isEmpty()) continue;
            if (full.length() > 0) full.append(", ");
            full.append(line);
        }
        if (title.isEmpty() && full.length() == 0) return null;
        return new Result(title, full.toString());
    }

    private static Result fromNominatim(double lat, double lng) throws Exception {
        String url = String.format(Locale.US,
                "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=%.6f&lon=%.6f&accept-language=%s",
                lat, lng, Locale.getDefault().getLanguage());
        String body = httpGet(url);
        JSONObject o = new JSONObject(body);
        JSONObject addr = o.optJSONObject("address");
        String full = o.optString("display_name", "");
        String title = "";
        if (addr != null) {
            String city = firstNonEmpty(addr.optString("city"), addr.optString("town"),
                    addr.optString("village"), addr.optString("suburb"), addr.optString("county"));
            title = join(city, addr.optString("state"), addr.optString("country"));
        }
        if (title.isEmpty() && full.isEmpty()) return null;
        return new Result(title, full);
    }

    static String httpGet(String url) throws Exception {
        byte[] b = httpGetBytes(url);
        return new String(b, "UTF-8");
    }

    static byte[] httpGetBytes(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(10000);
        // Required by the OpenStreetMap tile and Nominatim usage policies.
        c.setRequestProperty("User-Agent", "ProjectSarathi-GPSCamera/1.0 (Android)");
        try {
            if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) if (v != null && !v.trim().isEmpty()) return v.trim();
        return "";
    }

    private static String join(String... parts) {
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (p == null || p.trim().isEmpty()) continue;
            if (sb.length() > 0) sb.append(", ");
            sb.append(p.trim());
        }
        return sb.toString();
    }
}
