package com.ahuva.ipfinder.core;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** IPv4 helpers and target-range parsing (CIDR, dash ranges, wildcards, lists, hostnames). */
public final class IpUtils {
    /** Hard cap so a typo like 10.0.0.0/8 can't lock up the phone. */
    public static final int MAX_TARGETS = 65536;

    private IpUtils() {}

    public static long toLong(String ip) {
        String[] p = ip.trim().split("\\.");
        if (p.length != 4) throw new IllegalArgumentException("Not an IPv4 address: " + ip);
        long v = 0;
        for (String s : p) {
            int o = Integer.parseInt(s.trim());
            if (o < 0 || o > 255) throw new IllegalArgumentException("Bad octet in " + ip);
            v = (v << 8) | o;
        }
        return v;
    }

    public static long toLong(byte[] b) {
        return ((b[0] & 0xFFL) << 24) | ((b[1] & 0xFFL) << 16) | ((b[2] & 0xFFL) << 8) | (b[3] & 0xFFL);
    }

    public static String toIp(long v) {
        return ((v >> 24) & 0xFF) + "." + ((v >> 16) & 0xFF) + "." + ((v >> 8) & 0xFF) + "." + (v & 0xFF);
    }

    public static byte[] toBytes(long v) {
        return new byte[]{(byte) (v >> 24), (byte) (v >> 16), (byte) (v >> 8), (byte) v};
    }

    public static boolean isIpv4(String s) {
        if (s == null) return false;
        String[] p = s.trim().split("\\.", -1);
        if (p.length != 4) return false;
        for (String o : p) {
            if (o.isEmpty() || o.length() > 3) return false;
            for (int i = 0; i < o.length(); i++) if (!Character.isDigit(o.charAt(i))) return false;
            if (Integer.parseInt(o) > 255) return false;
        }
        return true;
    }

    public static long maskOf(int prefix) {
        if (prefix <= 0) return 0;
        return (0xFFFFFFFFL << (32 - prefix)) & 0xFFFFFFFFL;
    }

    public static int prefixOf(String mask) {
        long m = toLong(mask);
        return Long.bitCount(m);
    }

    /** Usable host range for a subnet, as "first-last". /31 and /32 include every address. */
    public static String cidrToRange(String ip, int prefix) {
        long[] r = cidrBounds(toLong(ip), prefix);
        return toIp(r[0]) + "-" + toIp(r[1]);
    }

    public static long[] cidrBounds(long ip, int prefix) {
        long mask = maskOf(prefix);
        long net = ip & mask;
        long bcast = net | (~mask & 0xFFFFFFFFL);
        if (prefix >= 31) return new long[]{net, bcast};
        return new long[]{net + 1, bcast - 1};
    }

    public static boolean isPrivate(long v) {
        long a = v >> 24, b = (v >> 16) & 0xFF;
        return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168)
                || (a == 100 && b >= 64 && b <= 127) || (a == 169 && b == 254);
    }

    /**
     * Parses a target spec into addresses. Accepts any mix, separated by commas, spaces or new lines:
     * 192.168.1.10, 192.168.1.0/24, 192.168.1.1-254, 10.0.0.1-10.0.1.20, 192.168.1.*, router.lan
     */
    public static List<Long> parseTargets(String spec) {
        if (spec == null || spec.trim().isEmpty()) throw new IllegalArgumentException("Enter an IP range to scan");
        Set<Long> out = new LinkedHashSet<>();
        for (String raw : spec.split("[,;\\s]+")) {
            String t = raw.trim();
            if (t.isEmpty()) continue;
            addToken(t, out);
            if (out.size() > MAX_TARGETS)
                throw new IllegalArgumentException("Range too large (max " + MAX_TARGETS + " addresses)");
        }
        if (out.isEmpty()) throw new IllegalArgumentException("No addresses in range");
        return new ArrayList<>(out);
    }

    private static void addToken(String t, Set<Long> out) {
        try {
            if (t.contains("/")) {
                String[] p = t.split("/");
                int prefix = p[1].contains(".") ? prefixOf(p[1]) : Integer.parseInt(p[1]);
                if (prefix < 0 || prefix > 32) throw new IllegalArgumentException();
                if (prefix < 16) throw new IllegalArgumentException("Prefix /" + prefix + " is too large, use /16 or smaller");
                long[] r = cidrBounds(toLong(p[0]), prefix);
                addRange(r[0], r[1], out);
            } else if (t.contains("*")) {
                String a = t.replace("*", "0"), b = t.replace("*", "255");
                long lo = toLong(a), hi = toLong(b);
                if ((lo & 0xFF) == 0) lo++;
                if ((hi & 0xFF) == 255) hi--;
                addRange(lo, hi, out);
            } else if (t.contains("-")) {
                String[] p = t.split("-", 2);
                long lo = toLong(p[0]);
                long hi;
                if (isIpv4(p[1])) {
                    hi = toLong(p[1]);
                } else {
                    // Partial end, e.g. 192.168.1.10-50 or 10.0.0.1-1.20
                    String[] lp = p[0].trim().split("\\.");
                    String[] rp = p[1].trim().split("\\.");
                    if (rp.length > 4) throw new IllegalArgumentException();
                    StringBuilder sb = new StringBuilder();
                    for (int i = 0; i < 4 - rp.length; i++) sb.append(lp[i]).append('.');
                    sb.append(p[1].trim());
                    hi = toLong(sb.toString());
                }
                if (hi < lo) { long x = lo; lo = hi; hi = x; }
                addRange(lo, hi, out);
            } else if (isIpv4(t)) {
                out.add(toLong(t));
            } else {
                // Hostname: resolve all IPv4 addresses.
                boolean any = false;
                for (InetAddress a : InetAddress.getAllByName(t)) {
                    if (a instanceof Inet4Address) { out.add(toLong(a.getAddress())); any = true; }
                }
                if (!any) throw new IllegalArgumentException("No IPv4 address for " + t);
            }
        } catch (IllegalArgumentException e) {
            String m = e.getMessage();
            throw new IllegalArgumentException(m != null && !m.startsWith("For input") ? m : "Invalid range: " + t);
        } catch (Exception e) {
            throw new IllegalArgumentException("Cannot resolve " + t);
        }
    }

    private static void addRange(long lo, long hi, Set<Long> out) {
        if (hi - lo + 1 > MAX_TARGETS)
            throw new IllegalArgumentException("Range too large (max " + MAX_TARGETS + " addresses)");
        for (long v = lo; v <= hi; v++) out.add(v);
    }

    public static String reverseName(String ip) {
        String[] p = ip.split("\\.");
        return p[3] + "." + p[2] + "." + p[1] + "." + p[0] + ".in-addr.arpa";
    }

    public static String normalizeMac(String mac) {
        if (mac == null) return null;
        String hex = mac.replaceAll("[^0-9A-Fa-f]", "").toUpperCase(Locale.US);
        if (hex.length() != 12 || hex.equals("000000000000") || hex.equals("FFFFFFFFFFFF")) return null;
        StringBuilder sb = new StringBuilder(17);
        for (int i = 0; i < 12; i += 2) {
            if (i > 0) sb.append(':');
            sb.append(hex, i, i + 2);
        }
        return sb.toString();
    }

    public static byte[] macBytes(String mac) {
        String n = normalizeMac(mac);
        if (n == null) throw new IllegalArgumentException("Invalid MAC address");
        String hex = n.replace(":", "");
        byte[] b = new byte[6];
        for (int i = 0; i < 6; i++) b[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        return b;
    }

    /** Locally administered bit set, i.e. a randomized/private MAC (common on phones). */
    public static boolean isRandomizedMac(String mac) {
        String n = normalizeMac(mac);
        if (n == null) return false;
        int first = Integer.parseInt(n.substring(0, 2), 16);
        return (first & 0x02) != 0;
    }
}
