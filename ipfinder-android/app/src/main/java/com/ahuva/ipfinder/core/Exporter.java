package com.ahuva.ipfinder.core;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Scan result export: CSV (Excel friendly), HTML report, JSON and plain text. */
public final class Exporter {
    public static final String CSV = "csv", HTML = "html", JSON = "json", TXT = "txt";

    private Exporter() {}

    public static String mime(String fmt) {
        switch (fmt) {
            case CSV: return "text/csv";
            case HTML: return "text/html";
            case JSON: return "application/json";
            default: return "text/plain";
        }
    }

    public static String fileName(String fmt) {
        return "ip-scan-" + new SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(new Date()) + "." + fmt;
    }

    public static String export(List<Device> list, String fmt, String range) {
        switch (fmt) {
            case CSV: return csv(list);
            case HTML: return html(list, range);
            case JSON: return json(list, range);
            default: return text(list, range);
        }
    }

    static String csv(List<Device> list) {
        StringBuilder sb = new StringBuilder("\uFEFF"); // BOM so Excel reads UTF-8
        sb.append("Status,Name,IP,MAC,Manufacturer,Type,OS,Hostname,NetBIOS,Workgroup,mDNS,Model,Open ports,Services,HTTP title,Ping ms,Favorite,Notes\r\n");
        for (Device d : list) {
            synchronized (d) {
                String[] row = {d.alive ? "Online" : "Offline", d.displayName(), d.ip, d.mac, vendorOf(d), d.type, d.os,
                        d.hostname, d.netbiosName, d.workgroup, d.mdnsName, d.model, joinPorts(d), join(d.services),
                        d.httpTitle, d.rttMs >= 0 ? String.valueOf(d.rttMs) : "", d.favorite ? "yes" : "", d.notes};
                for (int i = 0; i < row.length; i++) {
                    if (i > 0) sb.append(',');
                    sb.append(csvCell(row[i]));
                }
                sb.append("\r\n");
            }
        }
        return sb.toString();
    }

    static String csvCell(String v) {
        if (v == null) return "";
        String s = v;
        // Neutralise spreadsheet formula injection from device-supplied names.
        if (!s.isEmpty() && "=+-@".indexOf(s.charAt(0)) >= 0) s = "'" + s;
        if (s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r")) s = "\"" + s.replace("\"", "\"\"") + "\"";
        return s;
    }

    static String json(List<Device> list, String range) {
        JSONObject o = new JSONObject();
        try {
            o.put("generator", "Ahuva IP Finder");
            o.put("range", range);
            o.put("date", new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US).format(new Date()));
            JSONArray arr = new JSONArray();
            for (Device d : list) {
                JSONObject j = d.toJson();
                synchronized (d) {
                    j.put("name", d.displayName());
                    if (d.customName != null) j.put("customName", d.customName);
                    if (d.notes != null) j.put("notes", d.notes);
                    j.put("favorite", d.favorite);
                }
                arr.put(j);
            }
            o.put("devices", arr);
            return o.toString(2);
        } catch (JSONException e) {
            return "{}";
        }
    }

    static String text(List<Device> list, String range) {
        StringBuilder sb = new StringBuilder();
        sb.append("Ahuva IP Finder scan - ").append(range).append(" - ")
                .append(new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date())).append('\n');
        for (Device d : list) sb.append(describe(d)).append('\n');
        return sb.toString();
    }

    /** Multi-line human readable description of one device (used by Share and Copy). */
    public static String describe(Device d) {
        StringBuilder sb = new StringBuilder();
        synchronized (d) {
            String name = d.displayName();
            sb.append(d.ip);
            if (!name.isEmpty()) sb.append("  ").append(name);
            sb.append('\n');
            line(sb, "Status", d.alive ? "Online" + (d.rttMs >= 0 ? " (" + d.rttMs + " ms)" : "") : "Offline");
            line(sb, "Type", d.type);
            line(sb, "OS", d.os);
            line(sb, "MAC", d.mac);
            line(sb, "Manufacturer", vendorOf(d));
            line(sb, "Model", d.model);
            line(sb, "Hostname", d.hostname);
            line(sb, "NetBIOS", d.netbiosName == null ? null : d.netbiosName + (d.workgroup != null ? " (" + d.workgroup + ")" : ""));
            line(sb, "mDNS", d.mdnsName);
            if (!d.openPorts.isEmpty()) {
                sb.append("  Services:\n");
                for (int p : d.openPorts) {
                    sb.append("    ").append(p).append("/tcp ").append(Ports.name(p));
                    String b = d.banners.get(p);
                    if (b != null) sb.append(" - ").append(b);
                    sb.append('\n');
                }
            }
            line(sb, "Notes", d.notes);
        }
        return sb.toString();
    }

    private static void line(StringBuilder sb, String k, String v) {
        if (v != null && !v.isEmpty()) sb.append("  ").append(k).append(": ").append(v).append('\n');
    }

    public static String vendorOf(Device d) {
        if (d.manufacturer != null && (d.vendor == null || d.vendor.startsWith("Private"))) return d.manufacturer;
        return d.vendor != null ? d.vendor : d.manufacturer;
    }

    static String joinPorts(Device d) {
        StringBuilder sb = new StringBuilder();
        for (int p : d.openPorts) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(p);
        }
        return sb.toString();
    }

    static String join(Iterable<String> it) {
        StringBuilder sb = new StringBuilder();
        for (String s : it) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(s);
        }
        return sb.toString();
    }

    static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    static String html(List<Device> list, String range) {
        int online = 0;
        for (Device d : list) if (d.alive) online++;
        StringBuilder sb = new StringBuilder();
        sb.append("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
                .append("<title>IP scan ").append(esc(range)).append("</title><style>")
                .append("body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:16px;color:#1f2328;background:#fff}")
                .append("h1{font-size:20px;margin:0 0 4px}p{color:#5f6368;margin:0 0 16px}")
                .append("table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top}")
                .append("th{background:#f3f4f6;position:sticky;top:0}tr.off td{color:#9aa0a6}code{font-size:12px}")
                .append("@media(prefers-color-scheme:dark){body{background:#121417;color:#e8eaed}th{background:#1c1f24}td,th{border-color:#2a2e35}}")
                .append("</style></head><body><h1>Network scan: ").append(esc(range)).append("</h1><p>")
                .append(online).append(" online of ").append(list.size()).append(" listed &middot; ")
                .append(new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date()))
                .append(" &middot; Ahuva IP Finder</p><table><thead><tr><th>Status</th><th>Name</th><th>IP</th><th>MAC</th>")
                .append("<th>Manufacturer</th><th>Type</th><th>Services</th></tr></thead><tbody>");
        for (Device d : list) {
            synchronized (d) {
                sb.append("<tr").append(d.alive ? "" : " class=\"off\"").append("><td>").append(d.alive ? "Online" : "Offline")
                        .append("</td><td>").append(esc(d.displayName())).append("</td><td><code>").append(esc(d.ip))
                        .append("</code></td><td><code>").append(esc(d.mac)).append("</code></td><td>").append(esc(vendorOf(d)))
                        .append("</td><td>").append(esc(d.type)).append("</td><td>");
                boolean first = true;
                for (Map.Entry<Integer, String> e : portsWithNames(d)) {
                    if (!first) sb.append("<br>");
                    first = false;
                    sb.append(e.getKey()).append(' ').append(esc(e.getValue()));
                }
                sb.append("</td></tr>");
            }
        }
        sb.append("</tbody></table></body></html>");
        return sb.toString();
    }

    private static List<Map.Entry<Integer, String>> portsWithNames(Device d) {
        java.util.List<Map.Entry<Integer, String>> l = new java.util.ArrayList<>();
        for (int p : d.openPorts) l.add(new java.util.AbstractMap.SimpleEntry<>(p, Ports.name(p)));
        return l;
    }
}
