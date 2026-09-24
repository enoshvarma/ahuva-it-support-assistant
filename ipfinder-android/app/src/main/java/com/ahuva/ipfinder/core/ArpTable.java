package com.ahuva.ipfinder.core;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.HashMap;
import java.util.Map;

/**
 * IP -> MAC from the kernel neighbour table. Android 10+ blocks /proc/net/arp and `ip neigh` for normal apps,
 * so this returns an empty map there and MACs come from NetBIOS instead.
 */
public final class ArpTable {
    private ArpTable() {}

    public static Map<String, String> read() {
        Map<String, String> m = new HashMap<>();
        readProc(m);
        if (m.isEmpty()) readIpNeigh(m);
        return m;
    }

    static void readProc(Map<String, String> m) {
        BufferedReader br = null;
        try {
            br = new BufferedReader(new FileReader("/proc/net/arp"));
            br.readLine(); // header
            String line;
            while ((line = br.readLine()) != null) parseProcLine(line, m);
        } catch (IOException | SecurityException ignored) {
        } finally {
            if (br != null) try { br.close(); } catch (IOException ignored) { }
        }
    }

    /** "192.168.1.1  0x1  0x2  aa:bb:cc:dd:ee:ff  *  wlan0" */
    static void parseProcLine(String line, Map<String, String> m) {
        String[] f = line.trim().split("\\s+");
        if (f.length < 4) return;
        if ("0x0".equals(f[2])) return; // incomplete
        String mac = IpUtils.normalizeMac(f[3]);
        if (mac != null && IpUtils.isIpv4(f[0])) m.put(f[0], mac);
    }

    static void readIpNeigh(Map<String, String> m) {
        Process p = null;
        try {
            p = new ProcessBuilder("ip", "-4", "neigh", "show").redirectErrorStream(true).start();
            BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()));
            String line;
            while ((line = br.readLine()) != null) parseNeighLine(line, m);
            p.waitFor();
        } catch (IOException | SecurityException ignored) {
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            if (p != null) p.destroy();
        }
    }

    /** "192.168.1.1 dev wlan0 lladdr aa:bb:cc:dd:ee:ff REACHABLE" */
    static void parseNeighLine(String line, Map<String, String> m) {
        String[] f = line.trim().split("\\s+");
        if (f.length < 5 || !IpUtils.isIpv4(f[0])) return;
        for (int i = 1; i < f.length - 1; i++) {
            if ("lladdr".equals(f[i])) {
                String state = f[f.length - 1];
                if ("FAILED".equals(state) || "INCOMPLETE".equals(state)) return;
                String mac = IpUtils.normalizeMac(f[i + 1]);
                if (mac != null) m.put(f[0], mac);
                return;
            }
        }
    }
}
