package com.ahuva.ipfinder.ui;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.RouteInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;

import com.ahuva.ipfinder.core.IpUtils;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Local interfaces, gateway, DNS and Wi-Fi details. */
public final class NetInfo {
    private NetInfo() {}

    public static final class Iface {
        public String name;
        public String kind;   // Wi-Fi, Ethernet, Hotspot, VPN, Mobile data, USB tether, Other
        public String ip;
        public int prefix;
        public String gateway;
        public List<String> dns = new ArrayList<>();
        public NetworkInterface nif;

        public String range() {
            int p = Math.max(prefix, 16); // never propose more than a /16
            if (p >= 31) return ip;
            return IpUtils.toIp(IpUtils.cidrBounds(IpUtils.toLong(ip), p)[0] - 1) + "/" + p;
        }

        public String broadcast() {
            long mask = IpUtils.maskOf(prefix);
            return IpUtils.toIp((IpUtils.toLong(ip) & mask) | (~mask & 0xFFFFFFFFL));
        }

        public String label() {
            return kind + " · " + ip + "/" + prefix;
        }
    }

    static String kindOf(String name) {
        String n = name.toLowerCase(Locale.US);
        if (n.startsWith("swlan") || n.startsWith("ap") || n.startsWith("softap") || n.startsWith("wlan1") || n.contains("hotspot")) return "Hotspot";
        if (n.startsWith("wlan") || n.startsWith("wifi") || n.startsWith("wl")) return "Wi-Fi";
        if (n.startsWith("eth") || n.startsWith("en")) return "Ethernet";
        if (n.startsWith("rndis") || n.startsWith("usb") || n.startsWith("ncm")) return "USB tether";
        if (n.startsWith("bt-pan") || n.startsWith("bt")) return "Bluetooth";
        if (n.startsWith("tun") || n.startsWith("ppp") || n.startsWith("ipsec") || n.startsWith("wg") || n.startsWith("tap")) return "VPN";
        if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("pdp") || n.startsWith("v4-") || n.startsWith("clat")
                || n.startsWith("seth") || n.startsWith("dummy") || n.startsWith("r_rmnet")) return "Mobile data";
        return "Other";
    }

    private static int rank(String kind) {
        switch (kind) {
            case "Wi-Fi": return 0;
            case "Ethernet": return 1;
            case "Hotspot": return 2;
            case "USB tether": return 3;
            case "Bluetooth": return 4;
            case "VPN": return 5;
            case "Other": return 6;
            default: return 7;
        }
    }

    /** All IPv4 interfaces, best scanning candidate first. */
    public static List<Iface> interfaces(Context c) {
        List<Iface> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                try {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                } catch (Exception e) {
                    continue;
                }
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress a = ia.getAddress();
                    if (!(a instanceof Inet4Address) || a.isLinkLocalAddress()) continue;
                    Iface f = new Iface();
                    f.name = ni.getName();
                    f.kind = kindOf(f.name);
                    f.ip = a.getHostAddress();
                    f.prefix = ia.getNetworkPrefixLength();
                    if (f.prefix <= 0 || f.prefix > 32) f.prefix = 24;
                    f.nif = ni;
                    out.add(f);
                }
            }
        } catch (Exception ignored) {
        }
        fillFromConnectivity(c, out);
        Collections.sort(out, new Comparator<Iface>() {
            @Override public int compare(Iface a, Iface b) {
                return rank(a.kind) - rank(b.kind);
            }
        });
        return out;
    }

    private static void fillFromConnectivity(Context c, List<Iface> list) {
        ConnectivityManager cm = (ConnectivityManager) c.getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            try {
                for (Network n : cm.getAllNetworks()) {
                    LinkProperties lp = cm.getLinkProperties(n);
                    if (lp == null || lp.getInterfaceName() == null) continue;
                    for (Iface f : list) {
                        if (!f.name.equals(lp.getInterfaceName())) continue;
                        for (RouteInfo r : lp.getRoutes()) {
                            if (r.isDefaultRoute() && r.getGateway() instanceof Inet4Address) {
                                String g = r.getGateway().getHostAddress();
                                if (!"0.0.0.0".equals(g)) f.gateway = g;
                            }
                        }
                        for (InetAddress d : lp.getDnsServers()) if (d instanceof Inet4Address) f.dns.add(d.getHostAddress());
                        for (LinkAddress la : lp.getLinkAddresses()) {
                            if (la.getAddress() instanceof Inet4Address && la.getAddress().getHostAddress().equals(f.ip))
                                f.prefix = la.getPrefixLength();
                        }
                    }
                }
            } catch (Exception ignored) {
            }
        }
        // Old devices / fallbacks: DHCP info from the Wi-Fi manager.
        for (Iface f : list) {
            if (!"Wi-Fi".equals(f.kind) || f.gateway != null) continue;
            try {
                WifiManager wm = (WifiManager) c.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                @SuppressWarnings("deprecation") DhcpInfo di = wm == null ? null : wm.getDhcpInfo();
                if (di != null && di.gateway != 0) {
                    f.gateway = intToIp(di.gateway);
                    if (di.dns1 != 0 && f.dns.isEmpty()) f.dns.add(intToIp(di.dns1));
                    if (di.dns2 != 0) f.dns.add(intToIp(di.dns2));
                }
            } catch (Exception ignored) {
            }
        }
        for (Iface f : list) {
            // When this phone is the hotspot it is the gateway for the clients.
            if (f.gateway == null && ("Hotspot".equals(f.kind) || "USB tether".equals(f.kind) || "Bluetooth".equals(f.kind))) f.gateway = f.ip;
        }
    }

    /** DhcpInfo ints are little-endian. */
    static String intToIp(int v) {
        return (v & 0xFF) + "." + ((v >> 8) & 0xFF) + "." + ((v >> 16) & 0xFF) + "." + ((v >> 24) & 0xFF);
    }

    public static final class Wifi {
        public String ssid, bssid;
        public int rssi, linkMbps, freqMhz;
    }

    @SuppressWarnings("deprecation")
    public static Wifi wifi(Context c) {
        try {
            WifiManager wm = (WifiManager) c.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm == null || !wm.isWifiEnabled()) return null;
            WifiInfo wi = wm.getConnectionInfo();
            if (wi == null || wi.getNetworkId() == -1 && wi.getIpAddress() == 0) return null;
            Wifi w = new Wifi();
            String ssid = wi.getSSID();
            if (ssid != null) ssid = ssid.replace("\"", "");
            w.ssid = ssid == null || ssid.equals("<unknown ssid>") || ssid.isEmpty() ? null : ssid;
            String bssid = wi.getBSSID();
            w.bssid = bssid == null || bssid.equals("02:00:00:00:00:00") ? null : bssid.toUpperCase(Locale.US);
            w.rssi = wi.getRssi();
            w.linkMbps = wi.getLinkSpeed();
            w.freqMhz = wi.getFrequency();
            return w;
        } catch (Exception e) {
            return null;
        }
    }

    public static String band(int freqMhz) {
        if (freqMhz >= 5925) return "6 GHz";
        if (freqMhz >= 4900) return "5 GHz";
        if (freqMhz >= 2400) return "2.4 GHz";
        return freqMhz > 0 ? freqMhz + " MHz" : "";
    }

    public static String signal(int rssi) {
        if (rssi >= -55) return "Excellent";
        if (rssi >= -67) return "Good";
        if (rssi >= -75) return "Fair";
        return "Weak";
    }
}
