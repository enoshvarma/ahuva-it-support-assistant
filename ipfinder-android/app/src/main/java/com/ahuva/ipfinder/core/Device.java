package com.ahuva.ipfinder.core;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Everything learned about one host. Fields are written by scanner threads, so access is synchronized. */
public class Device {
    public final String ip;
    public final long ipLong;

    public boolean alive;
    public int rttMs = -1;
    public String hostname;       // reverse DNS
    public String netbiosName;
    public String workgroup;
    public String netbiosUser;
    public String mdnsName;       // xxx.local
    public String friendlyName;   // mDNS fn= / SSDP friendlyName
    public String manufacturer;   // SSDP / mDNS TXT
    public String model;
    public String mac;
    public String vendor;
    public String os;             // best guess, e.g. "Windows", "iOS"
    public String httpTitle;
    public String httpServer;
    public String sshBanner;
    public String type = DeviceType.UNKNOWN;
    public boolean isGateway;
    public boolean isSelf;
    public boolean isNew;
    public long lastSeen;

    public final TreeSet<Integer> openPorts = new TreeSet<>();
    public final Map<Integer, String> banners = new LinkedHashMap<>();
    public final Set<String> services = new LinkedHashSet<>(); // mDNS service types, e.g. _ipp._tcp
    public final Set<String> sources = new LinkedHashSet<>();   // how we found it: ICMP, TCP, NetBIOS...

    // User data, merged in from the store.
    public String customName;
    public String notes;
    public boolean favorite;

    public Device(String ip) {
        this.ip = ip;
        this.ipLong = IpUtils.toLong(ip);
    }

    public synchronized void markAlive(String source) {
        alive = true;
        if (source != null) sources.add(source);
        lastSeen = System.currentTimeMillis();
    }

    public synchronized void addPort(int port, String banner) {
        openPorts.add(port);
        if (banner != null && !banner.isEmpty()) banners.put(port, banner);
    }

    public synchronized void setMacIfEmpty(String m) {
        String n = IpUtils.normalizeMac(m);
        if (n != null && mac == null) mac = n;
    }

    /** Stable key for favorites and names: MAC when it is a real (non-randomized) one, else IP. */
    public synchronized String key() {
        if (mac != null && !IpUtils.isRandomizedMac(mac)) return "mac:" + mac;
        return "ip:" + ip;
    }

    public synchronized String displayName() {
        String[] c = {customName, friendlyName, netbiosName, shortHost(mdnsName), shortHost(hostname)};
        for (String s : c) if (s != null && !s.trim().isEmpty()) return s.trim();
        if (isSelf) return "This device";
        if (isGateway) return "Gateway";
        return "";
    }

    /** Every name source, de-duplicated, for the detail screen. */
    public synchronized List<String> allNames() {
        Set<String> s = new LinkedHashSet<>();
        for (String n : new String[]{friendlyName, netbiosName, mdnsName, hostname}) if (n != null && !n.isEmpty()) s.add(n);
        return new ArrayList<>(s);
    }

    public synchronized String serviceSummary() {
        Set<String> tags = new LinkedHashSet<>();
        for (int p : openPorts) {
            String t = Ports.shortTag(p);
            if (t != null) tags.add(t);
        }
        StringBuilder sb = new StringBuilder();
        for (String t : tags) {
            if (sb.length() > 0) sb.append("  ");
            sb.append(t);
        }
        return sb.toString();
    }

    static String shortHost(String h) {
        if (h == null) return null;
        String s = h;
        if (s.endsWith(".")) s = s.substring(0, s.length() - 1);
        if (s.endsWith(".local")) s = s.substring(0, s.length() - 6);
        return s;
    }

    public synchronized JSONObject toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("ip", ip);
            o.put("alive", alive);
            o.put("rtt", rttMs);
            put(o, "hostname", hostname);
            put(o, "netbios", netbiosName);
            put(o, "workgroup", workgroup);
            put(o, "netbiosUser", netbiosUser);
            put(o, "mdns", mdnsName);
            put(o, "friendly", friendlyName);
            put(o, "manufacturer", manufacturer);
            put(o, "model", model);
            put(o, "mac", mac);
            put(o, "vendor", vendor);
            put(o, "os", os);
            put(o, "httpTitle", httpTitle);
            put(o, "httpServer", httpServer);
            put(o, "sshBanner", sshBanner);
            o.put("type", type);
            o.put("gateway", isGateway);
            o.put("self", isSelf);
            o.put("lastSeen", lastSeen);
            JSONArray ports = new JSONArray();
            for (int p : openPorts) ports.put(p);
            o.put("ports", ports);
            JSONObject b = new JSONObject();
            for (Map.Entry<Integer, String> e : banners.entrySet()) b.put(String.valueOf(e.getKey()), e.getValue());
            o.put("banners", b);
            o.put("services", new JSONArray(services));
            o.put("sources", new JSONArray(sources));
        } catch (JSONException ignored) {
        }
        return o;
    }

    public static Device fromJson(JSONObject o) {
        Device d = new Device(o.optString("ip"));
        d.alive = o.optBoolean("alive");
        d.rttMs = o.optInt("rtt", -1);
        d.hostname = opt(o, "hostname");
        d.netbiosName = opt(o, "netbios");
        d.workgroup = opt(o, "workgroup");
        d.netbiosUser = opt(o, "netbiosUser");
        d.mdnsName = opt(o, "mdns");
        d.friendlyName = opt(o, "friendly");
        d.manufacturer = opt(o, "manufacturer");
        d.model = opt(o, "model");
        d.mac = opt(o, "mac");
        d.vendor = opt(o, "vendor");
        d.os = opt(o, "os");
        d.httpTitle = opt(o, "httpTitle");
        d.httpServer = opt(o, "httpServer");
        d.sshBanner = opt(o, "sshBanner");
        d.type = o.optString("type", DeviceType.UNKNOWN);
        d.isGateway = o.optBoolean("gateway");
        d.isSelf = o.optBoolean("self");
        d.lastSeen = o.optLong("lastSeen");
        JSONArray ports = o.optJSONArray("ports");
        if (ports != null) for (int i = 0; i < ports.length(); i++) d.openPorts.add(ports.optInt(i));
        JSONObject b = o.optJSONObject("banners");
        if (b != null) {
            JSONArray names = b.names();
            if (names != null) for (int i = 0; i < names.length(); i++) {
                String k = names.optString(i);
                try { d.banners.put(Integer.parseInt(k), b.optString(k)); } catch (NumberFormatException ignored) { }
            }
        }
        JSONArray s = o.optJSONArray("services");
        if (s != null) for (int i = 0; i < s.length(); i++) d.services.add(s.optString(i));
        JSONArray src = o.optJSONArray("sources");
        if (src != null) for (int i = 0; i < src.length(); i++) d.sources.add(src.optString(i));
        return d;
    }

    private static void put(JSONObject o, String k, String v) throws JSONException {
        if (v != null) o.put(k, v);
    }

    private static String opt(JSONObject o, String k) {
        return o.has(k) && !o.isNull(k) ? o.optString(k) : null;
    }
}
