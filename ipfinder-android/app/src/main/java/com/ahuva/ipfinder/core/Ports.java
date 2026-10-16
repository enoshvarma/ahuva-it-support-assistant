package com.ahuva.ipfinder.core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/** Port catalogue: names, short tags and the default port lists. */
public final class Ports {
    private Ports() {}

    /** Probed on every address to decide whether it is alive when ICMP is blocked. A RST also counts. */
    public static final int[] ALIVE_PROBE = {80, 443, 22, 445, 139, 135, 3389, 8080, 53, 62078, 5000, 7000, 554, 8008, 9100, 23, 21, 49152};

    /** Default service ports checked on every live host. */
    public static final String DEFAULT_SERVICE_PORTS =
            "21,22,23,25,53,80,81,88,110,111,135,139,143,389,443,445,515,548,554,631,993,995,1080,1194,1433,1521,1723,"
                    + "1883,1900,2049,3000,3128,3306,3389,5000,5001,5060,5353,5432,5555,5800,5900,5985,6379,6881,7000,7547,8000,8008,"
                    + "8009,8080,8081,8083,8088,8123,8291,8443,8554,8888,9000,9090,9100,9200,10000,27017,32400,37777,49152,62078";

    private static final Map<Integer, String[]> NAMES = new HashMap<>();

    private static void n(int port, String tag, String name) {
        NAMES.put(port, new String[]{tag, name});
    }

    static {
        n(20, "FTP", "FTP data");
        n(21, "FTP", "FTP");
        n(22, "SSH", "SSH");
        n(23, "Telnet", "Telnet");
        n(25, "SMTP", "SMTP mail");
        n(53, "DNS", "DNS");
        n(67, "DHCP", "DHCP");
        n(69, "TFTP", "TFTP");
        n(80, "HTTP", "HTTP web");
        n(81, "HTTP", "HTTP (alt)");
        n(88, "Kerberos", "Kerberos");
        n(110, "POP3", "POP3 mail");
        n(111, "RPC", "Sun RPC / NFS");
        n(123, "NTP", "NTP");
        n(135, "MSRPC", "Microsoft RPC");
        n(137, "NetBIOS", "NetBIOS name");
        n(139, "SMB", "NetBIOS session / SMB");
        n(143, "IMAP", "IMAP mail");
        n(161, "SNMP", "SNMP");
        n(179, "BGP", "BGP");
        n(389, "LDAP", "LDAP");
        n(443, "HTTPS", "HTTPS web");
        n(445, "SMB", "SMB file sharing");
        n(465, "SMTPS", "SMTP over TLS");
        n(502, "Modbus", "Modbus");
        n(515, "LPD", "LPD printing");
        n(548, "AFP", "Apple file sharing");
        n(554, "RTSP", "RTSP video stream");
        n(587, "SMTP", "SMTP submission");
        n(631, "IPP", "IPP printing / CUPS");
        n(636, "LDAPS", "LDAP over TLS");
        n(873, "rsync", "rsync");
        n(993, "IMAPS", "IMAP over TLS");
        n(995, "POP3S", "POP3 over TLS");
        n(1080, "SOCKS", "SOCKS proxy");
        n(1194, "OpenVPN", "OpenVPN");
        n(1433, "MSSQL", "Microsoft SQL Server");
        n(1521, "Oracle", "Oracle DB");
        n(1723, "PPTP", "PPTP VPN");
        n(1883, "MQTT", "MQTT broker");
        n(1900, "UPnP", "UPnP");
        n(2049, "NFS", "NFS");
        n(2375, "Docker", "Docker API");
        n(3000, "HTTP", "Web app (3000)");
        n(3128, "Proxy", "HTTP proxy");
        n(3306, "MySQL", "MySQL / MariaDB");
        n(3389, "RDP", "Remote Desktop");
        n(5000, "HTTP", "Web / UPnP / Synology");
        n(5001, "HTTPS", "Web TLS / Synology");
        n(5060, "SIP", "SIP VoIP");
        n(5353, "mDNS", "Multicast DNS");
        n(5432, "Postgres", "PostgreSQL");
        n(5555, "ADB", "Android debug bridge");
        n(5800, "VNC", "VNC over HTTP");
        n(5900, "VNC", "VNC remote desktop");
        n(5901, "VNC", "VNC :1");
        n(5985, "WinRM", "WinRM");
        n(6379, "Redis", "Redis");
        n(6881, "BT", "BitTorrent");
        n(7000, "AirPlay", "AirPlay");
        n(7547, "TR-069", "TR-069 CWMP");
        n(8000, "HTTP", "HTTP (8000)");
        n(8008, "HTTP", "HTTP (8008) / Chromecast");
        n(8009, "Cast", "Chromecast / AJP");
        n(8080, "HTTP", "HTTP proxy / alt web");
        n(8081, "HTTP", "HTTP (8081)");
        n(8083, "HTTP", "HTTP (8083)");
        n(8088, "HTTP", "HTTP (8088)");
        n(8123, "HTTP", "Home Assistant");
        n(8291, "Winbox", "MikroTik Winbox");
        n(8443, "HTTPS", "HTTPS (8443)");
        n(8554, "RTSP", "RTSP (8554)");
        n(8888, "HTTP", "HTTP (8888)");
        n(9000, "HTTP", "HTTP (9000)");
        n(9090, "HTTP", "HTTP (9090)");
        n(9100, "Print", "Raw printing (JetDirect)");
        n(9200, "Elastic", "Elasticsearch");
        n(10000, "HTTP", "Webmin / NDMP");
        n(27017, "MongoDB", "MongoDB");
        n(32400, "Plex", "Plex Media Server");
        n(37777, "DVR", "Dahua DVR");
        n(49152, "UPnP", "UPnP / Windows dynamic");
        n(62078, "iOS", "Apple iOS sync (lockdownd)");
    }

    public static String shortTag(int port) {
        String[] v = NAMES.get(port);
        return v == null ? null : v[0];
    }

    public static String name(int port) {
        String[] v = NAMES.get(port);
        return v == null ? "Unknown" : v[1];
    }

    public static boolean isHttp(int p) {
        return p == 80 || p == 81 || p == 3000 || p == 5000 || p == 8000 || p == 8008 || p == 8080 || p == 8081
                || p == 8083 || p == 8088 || p == 8123 || p == 8888 || p == 9000 || p == 9090 || p == 10000 || p == 32400;
    }

    public static boolean isHttps(int p) {
        return p == 443 || p == 5001 || p == 8443;
    }

    /** Parses "22,80,8000-8100". Returns sorted unique ports. */
    public static int[] parse(String spec) {
        TreeSet<Integer> set = new TreeSet<>();
        if (spec != null) {
            for (String t : spec.split("[,;\\s]+")) {
                t = t.trim();
                if (t.isEmpty()) continue;
                try {
                    if (t.contains("-")) {
                        String[] p = t.split("-", 2);
                        int a = Integer.parseInt(p[0].trim()), b = Integer.parseInt(p[1].trim());
                        if (a > b) { int x = a; a = b; b = x; }
                        for (int i = Math.max(1, a); i <= Math.min(65535, b); i++) set.add(i);
                    } else {
                        int v = Integer.parseInt(t);
                        if (v >= 1 && v <= 65535) set.add(v);
                    }
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("Invalid port: " + t);
                }
            }
        }
        int[] r = new int[set.size()];
        int i = 0;
        for (int v : set) r[i++] = v;
        return r;
    }

    public static List<Integer> toList(int[] a) {
        List<Integer> l = new ArrayList<>(a.length);
        for (int v : a) l.add(v);
        return l;
    }
}
