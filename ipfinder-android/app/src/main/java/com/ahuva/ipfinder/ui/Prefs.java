package com.ahuva.ipfinder.ui;

import android.content.Context;
import android.content.SharedPreferences;

import com.ahuva.ipfinder.core.Ports;
import com.ahuva.ipfinder.core.Scanner;

/** User settings. */
public final class Prefs {
    private static Prefs instance;
    private final SharedPreferences sp;

    private Prefs(Context c) {
        sp = c.getApplicationContext().getSharedPreferences("settings", Context.MODE_PRIVATE);
    }

    public static synchronized Prefs get(Context c) {
        if (instance == null) instance = new Prefs(c);
        return instance;
    }

    public int threads() { return clamp(sp.getInt("threads", 64), 4, 256); }
    public int pingTimeout() { return clamp(sp.getInt("ping_timeout", 700), 100, 10000); }
    public int tcpTimeout() { return clamp(sp.getInt("tcp_timeout", 700), 100, 10000); }
    public String servicePorts() { return sp.getString("service_ports", Ports.DEFAULT_SERVICE_PORTS); }
    public boolean netbios() { return sp.getBoolean("netbios", true); }
    public boolean mdns() { return sp.getBoolean("mdns", true); }
    public boolean ssdp() { return sp.getBoolean("ssdp", true); }
    public boolean reverseDns() { return sp.getBoolean("rdns", true); }
    public boolean httpInfo() { return sp.getBoolean("http", true); }
    public boolean scanServices() { return sp.getBoolean("services", true); }
    public boolean includeDead() { return sp.getBoolean("dead", false); }
    public boolean keepScreenOn() { return sp.getBoolean("screen_on", true); }
    public String theme() { return sp.getString("theme", "system"); }
    public String lastRange() { return sp.getString("last_range", null); }
    public String sort() { return sp.getString("sort", "ip"); }

    public void setInt(String k, int v) { sp.edit().putInt(k, v).apply(); }
    public void setBool(String k, boolean v) { sp.edit().putBoolean(k, v).apply(); }
    public void setString(String k, String v) { sp.edit().putString(k, v).apply(); }
    public boolean getBool(String k, boolean def) { return sp.getBoolean(k, def); }

    public void reset() {
        String range = lastRange();
        sp.edit().clear().apply();
        if (range != null) setString("last_range", range);
    }

    public void applyTo(Scanner.Config c) {
        c.threads = threads();
        c.pingTimeoutMs = pingTimeout();
        c.tcpTimeoutMs = tcpTimeout();
        try {
            c.servicePorts = Ports.parse(servicePorts());
        } catch (IllegalArgumentException e) {
            c.servicePorts = Ports.parse(Ports.DEFAULT_SERVICE_PORTS);
        }
        c.netbios = netbios();
        c.mdns = mdns();
        c.ssdp = ssdp();
        c.reverseDns = reverseDns();
        c.httpInfo = httpInfo();
        c.scanServices = scanServices();
        c.includeDead = includeDead();
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
