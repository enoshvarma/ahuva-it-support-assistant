package com.ahuva.ipfinder.ui;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;

import com.ahuva.ipfinder.core.Classifier;
import com.ahuva.ipfinder.core.Device;
import com.ahuva.ipfinder.core.IpUtils;
import com.ahuva.ipfinder.core.OuiDb;
import com.ahuva.ipfinder.core.Scanner;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/** Process-wide scan state, so results survive rotation and navigating between screens. */
public final class ScanSession {
    public interface Observer {
        void onScanChanged();
    }

    private static ScanSession instance;

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Observer> observers = new CopyOnWriteArrayList<>();
    private final Map<String, Device> devices = new LinkedHashMap<>();
    private volatile OuiDb oui;
    private Scanner scanner;
    private WifiManager.MulticastLock multicastLock;

    public volatile boolean running;
    public volatile String stage = "";
    public volatile int done, total;
    public String range;
    public long startedAt, finishedAt, elapsedMs;
    public boolean fromHistory;
    private boolean refreshPosted;

    private ScanSession(Context c) {
        app = c.getApplicationContext();
        Store s = Store.get(app);
        List<Device> last = s.lastScan();
        if (!last.isEmpty()) {
            for (Device d : last) devices.put(d.ip, d);
            range = s.lastScanRange();
            finishedAt = s.lastScanTime();
            fromHistory = true;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                oui();
            }
        }, "oui-load").start();
    }

    public static synchronized ScanSession get(Context c) {
        if (instance == null) instance = new ScanSession(c);
        return instance;
    }

    public OuiDb oui() {
        OuiDb db = oui;
        if (db != null) return db;
        synchronized (this) {
            if (oui == null) {
                InputStream in = null;
                try {
                    in = app.getAssets().open("oui.txt.gz");
                    oui = OuiDb.load(in);
                } catch (Exception e) {
                    oui = OuiDb.empty();
                } finally {
                    if (in != null) try { in.close(); } catch (Exception ignored) { }
                }
            }
            return oui;
        }
    }

    public void addObserver(Observer o) { observers.add(o); }

    public void removeObserver(Observer o) { observers.remove(o); }

    public synchronized List<Device> snapshot() {
        List<Device> l = new ArrayList<>(devices.values());
        Collections.sort(l, new Comparator<Device>() {
            @Override public int compare(Device a, Device b) {
                return Long.compare(a.ipLong, b.ipLong);
            }
        });
        return l;
    }

    public synchronized Device find(String ip) {
        return devices.get(ip);
    }

    /** Coalesces rapid scanner callbacks into at most ~4 UI refreshes per second. */
    private void postRefresh(boolean immediate) {
        synchronized (this) {
            if (refreshPosted && !immediate) return;
            refreshPosted = true;
        }
        main.postDelayed(new Runnable() {
            @Override public void run() {
                synchronized (ScanSession.this) {
                    refreshPosted = false;
                }
                notifyObservers();
            }
        }, immediate ? 0 : 250);
    }

    public void notifyObservers() {
        for (Observer o : observers) o.onScanChanged();
    }

    /** @param targets already parsed with {@link IpUtils#parseTargets} (off the UI thread: it may resolve hostnames) */
    public void start(String spec, List<Long> targets, NetInfo.Iface iface) {
        if (running) return;
        final Prefs prefs = Prefs.get(app);
        final Scanner.Config cfg = new Scanner.Config();
        cfg.targets = targets;
        prefs.applyTo(cfg);
        if (iface != null) {
            cfg.selfIp = iface.ip;
            cfg.gatewayIp = iface.gateway;
            cfg.dnsServers = iface.dns;
            cfg.nif = iface.nif;
        }
        cfg.oui = oui();
        synchronized (this) {
            devices.clear();
        }
        range = spec;
        running = true;
        fromHistory = false;
        stage = "Starting";
        done = 0;
        total = cfg.targets.size();
        startedAt = System.currentTimeMillis();
        acquireMulticast();
        prefs.setString("last_range", spec);
        final Store store = Store.get(app);
        scanner = new Scanner(cfg, new Scanner.Listener() {
            @Override public void onStage(String s) {
                stage = s;
                postRefresh(true);
            }

            @Override public void onProgress(int d, int t) {
                done = d;
                total = t;
                postRefresh(false);
            }

            @Override public void onDevice(Device d) {
                boolean added;
                synchronized (ScanSession.this) {
                    added = !devices.containsKey(d.ip);
                    if (added) devices.put(d.ip, d);
                }
                if (added) store.apply(d);
                synchronized (d) {
                    if (d.mac != null && d.vendor == null) d.vendor = cfg.oui.lookup(d.mac);
                }
                postRefresh(false);
            }

            @Override public void onComplete(final List<Device> result, final long ms, final boolean cancelled) {
                for (Device d : result) {
                    store.apply(d); // MAC may be known now, so the key can change
                    if (d.alive) Classifier.classify(d);
                }
                store.markKnown(result);
                if (!cancelled) store.saveLastScan(range, result, System.currentTimeMillis());
                main.post(new Runnable() {
                    @Override public void run() {
                        synchronized (ScanSession.this) {
                            devices.clear();
                            for (Device d : result) devices.put(d.ip, d);
                        }
                        running = false;
                        elapsedMs = ms;
                        finishedAt = System.currentTimeMillis();
                        stage = cancelled ? "Stopped" : "Done";
                        releaseMulticast();
                        notifyObservers();
                    }
                });
            }
        });
        scanner.start();
        postRefresh(true);
    }

    public void stop() {
        Scanner s = scanner;
        if (s != null && running) {
            stage = "Stopping";
            s.cancel();
            postRefresh(true);
        }
    }

    public void clear() {
        if (running) return;
        synchronized (this) {
            devices.clear();
        }
        range = null;
        finishedAt = 0;
        fromHistory = false;
        Store.get(app).clearHistory();
        notifyObservers();
    }

    /** Re-reads names / favorites after the user edits them on the detail screen. */
    public void userDataChanged() {
        postRefresh(true);
    }

    private void acquireMulticast() {
        try {
            WifiManager wm = (WifiManager) app.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                multicastLock = wm.createMulticastLock("ipfinder-scan");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
        } catch (Exception ignored) {
        }
    }

    private void releaseMulticast() {
        try {
            if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        } catch (Exception ignored) {
        }
        multicastLock = null;
    }
}
