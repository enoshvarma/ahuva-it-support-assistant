package com.ahuva.ipfinder.core;

import java.io.ByteArrayOutputStream;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/** Minimal DNS / mDNS message builder and parser (A, AAAA, PTR, SRV, TXT). */
public final class DnsPacket {
    public static final int TYPE_A = 1, TYPE_PTR = 12, TYPE_TXT = 16, TYPE_AAAA = 28, TYPE_SRV = 33, TYPE_ANY = 255;
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private DnsPacket() {}

    public static final class Record {
        public String name;
        public int type;
        public long ttl;
        /** A/AAAA: address, PTR: target name, TXT: "k=v" strings joined by \n, SRV: target host. */
        public String data;
        public int port; // SRV
        public final List<String> txt = new ArrayList<>();

        @Override public String toString() {
            return name + " " + type + " " + data + (port > 0 ? ":" + port : "");
        }
    }

    public static final class Message {
        public int id;
        public boolean response;
        public int rcode;
        public final List<Record> records = new ArrayList<>(); // answers + authority + additional
    }

    public static byte[] query(int id, String name, int type, boolean unicastResponse, boolean recursionDesired) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(64);
        out.write(id >> 8);
        out.write(id);
        out.write(recursionDesired ? 0x01 : 0x00);
        out.write(0x00);
        out.write(0); out.write(1); // QDCOUNT
        for (int i = 0; i < 6; i++) out.write(0);
        writeName(out, name);
        out.write(type >> 8);
        out.write(type);
        out.write(unicastResponse ? 0x80 : 0x00);
        out.write(0x01);
        return out.toByteArray();
    }

    static void writeName(ByteArrayOutputStream out, String name) {
        String n = name.endsWith(".") ? name.substring(0, name.length() - 1) : name;
        for (String label : n.split("\\.")) {
            byte[] b = label.getBytes(UTF8);
            out.write(b.length);
            out.write(b, 0, b.length);
        }
        out.write(0);
    }

    public static Message parse(byte[] buf, int len) {
        Message m = new Message();
        if (len < 12) throw new IllegalArgumentException("short packet");
        m.id = u16(buf, 0);
        m.response = (buf[2] & 0x80) != 0;
        m.rcode = buf[3] & 0x0F;
        int qd = u16(buf, 4), an = u16(buf, 6), ns = u16(buf, 8), ar = u16(buf, 10);
        int[] pos = {12};
        for (int i = 0; i < qd; i++) {
            readName(buf, len, pos);
            pos[0] += 4;
        }
        int total = an + ns + ar;
        for (int i = 0; i < total && pos[0] < len; i++) {
            Record r = new Record();
            r.name = readName(buf, len, pos);
            if (pos[0] + 10 > len) break;
            r.type = u16(buf, pos[0]);
            r.ttl = ((long) u16(buf, pos[0] + 4) << 16) | u16(buf, pos[0] + 6);
            int rdlen = u16(buf, pos[0] + 8);
            int rd = pos[0] + 10;
            if (rd + rdlen > len) break;
            switch (r.type) {
                case TYPE_A:
                    if (rdlen == 4) r.data = (buf[rd] & 0xFF) + "." + (buf[rd + 1] & 0xFF) + "." + (buf[rd + 2] & 0xFF) + "." + (buf[rd + 3] & 0xFF);
                    break;
                case TYPE_PTR: {
                    int[] p = {rd};
                    r.data = readName(buf, len, p);
                    break;
                }
                case TYPE_SRV: {
                    if (rdlen >= 7) {
                        r.port = u16(buf, rd + 4);
                        int[] p = {rd + 6};
                        r.data = readName(buf, len, p);
                    }
                    break;
                }
                case TYPE_TXT: {
                    int p = rd, end = rd + rdlen;
                    StringBuilder sb = new StringBuilder();
                    while (p < end) {
                        int l = buf[p] & 0xFF;
                        p++;
                        if (l == 0 || p + l > end) { p += l; continue; }
                        String s = new String(buf, p, l, UTF8);
                        r.txt.add(s);
                        if (sb.length() > 0) sb.append('\n');
                        sb.append(s);
                        p += l;
                    }
                    r.data = sb.toString();
                    break;
                }
                default:
                    break;
            }
            m.records.add(r);
            pos[0] = rd + rdlen;
        }
        return m;
    }

    static String readName(byte[] buf, int len, int[] pos) {
        StringBuilder sb = new StringBuilder();
        int p = pos[0];
        boolean jumped = false;
        int guard = 0;
        while (p < len && guard++ < 128) {
            int l = buf[p] & 0xFF;
            if (l == 0) {
                p++;
                break;
            }
            if ((l & 0xC0) == 0xC0) {
                if (p + 1 >= len) break;
                int ptr = ((l & 0x3F) << 8) | (buf[p + 1] & 0xFF);
                if (!jumped) pos[0] = p + 2;
                jumped = true;
                p = ptr;
                continue;
            }
            p++;
            if (p + l > len) break;
            if (sb.length() > 0) sb.append('.');
            sb.append(new String(buf, p, l, UTF8));
            p += l;
        }
        if (!jumped) pos[0] = p;
        return sb.toString();
    }

    static int u16(byte[] b, int o) {
        return ((b[o] & 0xFF) << 8) | (b[o + 1] & 0xFF);
    }

    /** Returns the value of key=value in a TXT record list (case-insensitive key), or null. */
    public static String txtValue(List<String> txt, String key) {
        String k = key.toLowerCase(java.util.Locale.US) + "=";
        for (String s : txt) if (s.toLowerCase(java.util.Locale.US).startsWith(k)) return s.substring(k.length());
        return null;
    }
}
