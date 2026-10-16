package com.ahuva.ipfinder.core;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/** IEEE OUI registry (MAC prefix -> manufacturer), bundled as a gzip'd "AABBCC<TAB>Vendor" list. */
public final class OuiDb {
    private final Map<Integer, String> map;

    private OuiDb(Map<Integer, String> map) {
        this.map = map;
    }

    public static OuiDb load(InputStream gz) throws IOException {
        Map<Integer, String> m = new HashMap<>(80000);
        BufferedReader br = new BufferedReader(new InputStreamReader(new GZIPInputStream(gz), Charset.forName("UTF-8")));
        try {
            String line;
            while ((line = br.readLine()) != null) {
                int tab = line.indexOf('\t');
                if (tab != 6) continue;
                try {
                    m.put(Integer.parseInt(line.substring(0, 6), 16), line.substring(7).intern());
                } catch (NumberFormatException ignored) {
                }
            }
        } finally {
            br.close();
        }
        return new OuiDb(m);
    }

    public static OuiDb empty() {
        return new OuiDb(new HashMap<Integer, String>());
    }

    public int size() {
        return map.size();
    }

    public String lookup(String mac) {
        String n = IpUtils.normalizeMac(mac);
        if (n == null) return null;
        if (IpUtils.isRandomizedMac(n)) return "Private (randomized MAC)";
        int key = Integer.parseInt(n.substring(0, 2) + n.substring(3, 5) + n.substring(6, 8), 16);
        return map.get(key);
    }
}
