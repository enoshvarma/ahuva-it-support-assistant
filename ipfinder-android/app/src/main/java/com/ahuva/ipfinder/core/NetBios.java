package com.ahuva.ipfinder.core;

import java.nio.charset.Charset;

/** NetBIOS Node Status (NBSTAT) query on UDP 137: gives Windows/Samba name, workgroup, user and MAC. */
public final class NetBios {
    public static final int PORT = 137;

    private NetBios() {}

    public static final class Info {
        public String name;
        public String group;
        public String user;
        public String mac;
    }

    public static byte[] nodeStatusRequest(int id) {
        byte[] p = new byte[50];
        p[0] = (byte) (id >> 8);
        p[1] = (byte) id;
        // flags 0x0000, QDCOUNT 1
        p[5] = 1;
        p[12] = 0x20;
        // "*" followed by 15 NULs, first-level encoded: '*'=0x2A -> 'C','K'; 0x00 -> 'A','A'
        p[13] = 'C';
        p[14] = 'K';
        for (int i = 15; i < 45; i++) p[i] = 'A';
        p[45] = 0;
        p[46] = 0x00; p[47] = 0x21; // NBSTAT
        p[48] = 0x00; p[49] = 0x01; // IN
        return p;
    }

    public static Info parse(byte[] b, int len) {
        if (len < 57) return null;
        int pos = 12;
        // Skip the answer name (labels or a compression pointer).
        if ((b[pos] & 0xC0) == 0xC0) {
            pos += 2;
        } else {
            while (pos < len && b[pos] != 0) pos += (b[pos] & 0xFF) + 1;
            pos++;
        }
        pos += 2 + 2 + 4; // type, class, ttl
        if (pos + 3 > len) return null;
        int type = ((b[pos - 8] & 0xFF) << 8) | (b[pos - 7] & 0xFF);
        if (type != 0x21) return null;
        pos += 2; // rdlength
        int count = b[pos] & 0xFF;
        pos++;
        Info info = new Info();
        Charset cs = Charset.forName("ISO-8859-1");
        for (int i = 0; i < count; i++) {
            if (pos + 18 > len) return info.name != null ? info : null;
            String name = new String(b, pos, 15, cs).trim();
            int suffix = b[pos + 15] & 0xFF;
            int flags = ((b[pos + 16] & 0xFF) << 8) | (b[pos + 17] & 0xFF);
            boolean group = (flags & 0x8000) != 0;
            if (suffix == 0x00 && !group && info.name == null) info.name = name;
            else if (suffix == 0x00 && group && info.group == null) info.group = name;
            else if (suffix == 0x20 && !group && info.name == null) info.name = name;
            else if (suffix == 0x03 && !group && info.user == null && !name.equalsIgnoreCase(info.name)) info.user = name;
            pos += 18;
        }
        if (pos + 6 <= len) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 6; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format(java.util.Locale.US, "%02X", b[pos + i] & 0xFF));
            }
            info.mac = IpUtils.normalizeMac(sb.toString()); // Samba reports 00:00:.. -> null
        }
        if (info.name != null && (info.name.isEmpty() || info.name.startsWith("\u0001"))) info.name = null;
        return info.name == null && info.group == null ? null : info;
    }
}
