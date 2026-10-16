package com.ahuva.ipfinder.ui;

import android.content.Context;
import android.content.SharedPreferences;

import com.ahuva.ipfinder.core.Device;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Persistent user data: favorites, custom names, notes, known devices and the last scan. */
public final class Store {
    private static Store instance;
    private final SharedPreferences sp;
    private final Set<String> known;

    private Store(Context c) {
        sp = c.getApplicationContext().getSharedPreferences("store", Context.MODE_PRIVATE);
        known = new HashSet<>(sp.getStringSet("known", new HashSet<String>()));
    }

    public static synchronized Store get(Context c) {
        if (instance == null) instance = new Store(c);
        return instance;
    }

    private JSONObject user(String key) {
        String s = sp.getString("u:" + key, null);
        if (s == null) return null;
        try {
            return new JSONObject(s);
        } catch (JSONException e) {
            return null;
        }
    }

    /** Copies favorite / name / notes onto a scanned device. */
    public synchronized void apply(Device d) {
        JSONObject u = user(d.key());
        if (u == null && !d.key().startsWith("ip:")) u = user("ip:" + d.ip); // saved before the MAC was known
        synchronized (d) {
            if (u != null) {
                d.customName = u.optString("name", null);
                if (d.customName != null && d.customName.isEmpty()) d.customName = null;
                d.notes = u.optString("notes", null);
                if (d.notes != null && d.notes.isEmpty()) d.notes = null;
                d.favorite = u.optBoolean("fav");
            } else {
                d.customName = null;
                d.notes = null;
                d.favorite = false;
            }
        }
    }

    public synchronized void save(Device d) {
        String key;
        JSONObject u = new JSONObject();
        synchronized (d) {
            key = d.key();
            try {
                u.put("name", d.customName == null ? "" : d.customName);
                u.put("notes", d.notes == null ? "" : d.notes);
                u.put("fav", d.favorite);
                u.put("ip", d.ip);
                if (d.mac != null) u.put("mac", d.mac);
                u.put("label", d.displayName());
                u.put("type", d.type);
                if (d.vendor != null) u.put("vendor", d.vendor);
            } catch (JSONException ignored) {
            }
        }
        SharedPreferences.Editor e = sp.edit();
        if (!key.startsWith("ip:")) e.remove("u:ip:" + d.ip);
        boolean empty = !u.optBoolean("fav") && u.optString("name").isEmpty() && u.optString("notes").isEmpty();
        if (empty) e.remove("u:" + key);
        else e.putString("u:" + key, u.toString());
        e.apply();
    }

    /** Favorites saved earlier, as lightweight offline devices (for the Favorites filter). */
    public synchronized List<Device> favorites() {
        List<Device> out = new ArrayList<>();
        for (Map.Entry<String, ?> en : sp.getAll().entrySet()) {
            if (!en.getKey().startsWith("u:") || !(en.getValue() instanceof String)) continue;
            try {
                JSONObject u = new JSONObject((String) en.getValue());
                if (!u.optBoolean("fav")) continue;
                Device d = new Device(u.optString("ip"));
                d.mac = u.optString("mac", null);
                d.customName = u.optString("name", null);
                if (d.customName != null && d.customName.isEmpty()) d.customName = u.optString("label", null);
                if (d.customName != null && d.customName.isEmpty()) d.customName = null;
                d.notes = u.optString("notes", null);
                d.vendor = u.optString("vendor", null);
                d.type = u.optString("type", d.type);
                d.favorite = true;
                out.add(d);
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    /** Marks never-seen devices as new and remembers them. */
    public synchronized void markKnown(List<Device> devices) {
        boolean firstScan = known.isEmpty();
        for (Device d : devices) {
            if (!d.alive) continue;
            String k = d.key();
            d.isNew = !firstScan && !known.contains(k);
            known.add(k);
        }
        sp.edit().putStringSet("known", new HashSet<>(known)).apply();
    }

    public synchronized void saveLastScan(String range, List<Device> devices, long time) {
        JSONArray arr = new JSONArray();
        int n = 0;
        for (Device d : devices) {
            if (!d.alive) continue;
            arr.put(d.toJson());
            if (++n >= 2048) break;
        }
        sp.edit().putString("last_scan", arr.toString()).putString("last_scan_range", range).putLong("last_scan_time", time).apply();
    }

    public synchronized List<Device> lastScan() {
        List<Device> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(sp.getString("last_scan", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                Device d = Device.fromJson(arr.getJSONObject(i));
                apply(d);
                out.add(d);
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    public String lastScanRange() { return sp.getString("last_scan_range", null); }

    public long lastScanTime() { return sp.getLong("last_scan_time", 0); }

    public synchronized void clearHistory() {
        known.clear();
        sp.edit().remove("known").remove("last_scan").remove("last_scan_range").remove("last_scan_time").apply();
    }

    public synchronized void clearAll() {
        known.clear();
        sp.edit().clear().apply();
    }
}
