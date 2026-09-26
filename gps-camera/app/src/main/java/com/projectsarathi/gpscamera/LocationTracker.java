package com.projectsarathi.gpscamera;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Looper;

import java.util.ArrayList;
import java.util.List;

/**
 * Plain {@link LocationManager} tracking (GPS + network). No Google Play Services needed, so it
 * works on every Android version and on phones without Google apps.
 */
public final class LocationTracker implements LocationListener {

    public interface Callback {
        void onLocation(Location location);
    }

    private static final long TWO_MINUTES = 2 * 60 * 1000;

    private final LocationManager manager;
    private final Callback callback;
    private Location best;

    public LocationTracker(Context context, Callback callback) {
        this.manager = (LocationManager) context.getApplicationContext().getSystemService(Context.LOCATION_SERVICE);
        this.callback = callback;
    }

    public Location getBest() {
        return best;
    }

    /** Caller must hold a location permission. */
    @SuppressLint("MissingPermission")
    public void start() {
        if (manager == null) return;
        List<String> providers = new ArrayList<>();
        for (String p : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
            try {
                if (manager.getAllProviders().contains(p)) providers.add(p);
            } catch (RuntimeException ignored) {
            }
        }
        for (String p : providers) {
            try {
                Location last = manager.getLastKnownLocation(p);
                if (last != null) consider(last);
            } catch (RuntimeException ignored) {
            }
            try {
                manager.requestLocationUpdates(p, 1000L, 0f, this, Looper.getMainLooper());
            } catch (RuntimeException ignored) {
                // SecurityException (permission revoked) or IllegalArgumentException (provider gone).
            }
        }
    }

    public void stop() {
        if (manager == null) return;
        try {
            manager.removeUpdates(this);
        } catch (RuntimeException ignored) {
        }
    }

    public boolean isGpsEnabled() {
        try {
            return manager != null && (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                    || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        } catch (RuntimeException e) {
            return false;
        }
    }

    private void consider(Location loc) {
        if (isBetter(loc, best)) {
            best = loc;
            callback.onLocation(loc);
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location != null) consider(location);
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
        // Required on Android 9 and older (abstract there).
    }

    @Override
    public void onProviderEnabled(String provider) {
    }

    @Override
    public void onProviderDisabled(String provider) {
    }

    /** The standard "is this fix better than what we have" heuristic from the Android docs. */
    static boolean isBetter(Location loc, Location current) {
        if (current == null) return true;
        long delta = loc.getTime() - current.getTime();
        if (delta > TWO_MINUTES) return true;
        if (delta < -TWO_MINUTES) return false;
        boolean newer = delta > 0;
        float accDelta = (loc.hasAccuracy() ? loc.getAccuracy() : 9999f)
                - (current.hasAccuracy() ? current.getAccuracy() : 9999f);
        boolean sameProvider = loc.getProvider() == null
                ? current.getProvider() == null : loc.getProvider().equals(current.getProvider());
        if (accDelta < 0) return true;
        if (newer && accDelta == 0) return true;
        if (newer && accDelta <= 200 && sameProvider) return true;
        // A GPS fix a few seconds newer is always worth showing so the coordinates keep moving.
        return newer && sameProvider && LocationManager.GPS_PROVIDER.equals(loc.getProvider());
    }
}
