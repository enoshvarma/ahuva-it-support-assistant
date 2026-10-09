package com.ahuva.ipfinder.core;

import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Network scan in two stages.
 * 1. Discovery: ICMP + TCP (RST counts) per address, in parallel with NetBIOS, mDNS and SSDP sweeps.
 * 2. Identification: reverse DNS, service ports, banners, HTTP titles, UPnP descriptions, vendor and type.
 */
public class Scanner {
    public static class Config {
        public List<Long> targets;
        public int threads = 64;
        public int pingTimeoutMs = 700;
        public int tcpTimeoutMs = 700;
        public int[] servicePorts = Ports.parse(Ports.DEFAULT_SERVICE_PORTS);
        public boolean netbios = true;
        public boolean mdns = true;
        public boolean ssdp = true;
        public boolean reverseDns = true;
        public boolean httpInfo = true;
        public boolean scanServices = true;
        public boolean includeDead = false;
        public String selfIp;
        public String gatewayIp;
        public List<String> dnsServers = new ArrayList<>();
        public NetworkInterface nif;
        public OuiDb oui = OuiDb.empty();
    }

    public interface Listener {
        void onStage(String stage);

        void onProgress(int done, int total);

        void onDevice(Device d);

        void onComplete(List<Device> devices, long elapsedMs, boolean cancelled);
    }

    private static final Pattern MAC_IN_TEXT = Pattern.compile("([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})");

    private final Config cfg;
    private final Listener listener;
    private final AtomicBoolean cancel = new AtomicBoolean();
    private final ConcurrentHashMap<String, Device> devices = new ConcurrentHashMap<>();
    private final Map<String, String> ssdpLocations = new ConcurrentHashMap<>();
    private final Set<Long> targetSet;
    private volatile ExecutorService pool;
    private volatile Thread thread;

    public Scanner(Config cfg, Listener listener) {
        this.cfg = cfg;
        this.listener = listener;
        this.targetSet = new HashSet<>(cfg.targets);
    }

    public void start() {
        thread = new Thread(new Runnable() {
            @Override public void run() {
                runScan();
            }
        }, "ip-scan");
        thread.start();
    }

    public void cancel() {
        cancel.set(true);
        ExecutorService p = pool;
        if (p != null) p.shutdownNow();
    }

    public boolean isCancelled() {
        return cancel.get();
    }

    /** Only addresses inside the scanned range become devices. */
    private Device device(String ip) {
        if (ip == null || !IpUtils.isIpv4(ip) || !targetSet.contains(IpUtils.toLong(ip))) return null;
        Device d = devices.get(ip);
        if (d == null) {
            Device n = new Device(ip);
            n.isSelf = ip.equals(cfg.selfIp);
            n.isGateway = ip.equals(cfg.gatewayIp);
            Device prev = devices.putIfAbsent(ip, n);
            d = prev != null ? prev : n;
        }
        return d;
    }

    private void emit(Device d) {
        if (d != null && !cancel.get()) listener.onDevice(d);
    }

    void runScan() {
        long start = System.currentTimeMillis();
        try {
            discover();
            if (!cancel.get()) identify();
        } catch (RuntimeException e) {
            // Never crash the app from the scan thread; report what we have.
        }
        List<Device> result = new ArrayList<>(devices.values());
        if (cfg.includeDead && !cancel.get()) {
            for (long v : cfg.targets) {
                String ip = IpUtils.toIp(v);
                if (!devices.containsKey(ip)) result.add(new Device(ip));
            }
        }
        Collections.sort(result, new Comparator<Device>() {
            @Override public int compare(Device a, Device b) {
                return Long.compare(a.ipLong, b.ipLong);
            }
        });
        listener.onComplete(result, System.currentTimeMillis() - start, cancel.get());
    }

    // ---------------------------------------------------------------- stage 1

    private void discover() {
        listener.onStage("Scanning " + cfg.targets.size() + " addresses");
        List<Thread> sweeps = new ArrayList<>();
        if (cfg.selfIp != null) {
            Device self = device(cfg.selfIp);
            if (self != null) { self.markAlive("Local"); self.rttMs = 0; emit(self); }
        }
        if (cfg.netbios) sweeps.add(bg("netbios", new Runnable() {
            @Override public void run() {
                UdpSweep.run(cfg.targets, NetBios.PORT, null, new UdpSweep.Payload() {
                    @Override public byte[] build(int index, long ip) {
                        return NetBios.nodeStatusRequest(0x4100 + (index & 0xFF));
                    }
                }, 1500, cancel, new UdpSweep.ReplyHandler() {
                    @Override public void onReply(String fromIp, byte[] data, int len) {
                        onNetBios(fromIp, NetBios.parse(data, len));
                    }
                });
            }
        }));
        if (cfg.mdns) {
            sweeps.add(bg("mdns-rev", new Runnable() {
                @Override public void run() {
                    Mdns.reverseSweep(cfg.targets, 1500, cancel, new Mdns.Handler() {
                        @Override public void onMessage(String fromIp, DnsPacket.Message msg) {
                            onMdns(fromIp, msg);
                        }
                    });
                }
            }));
            sweeps.add(bg("mdns-browse", new Runnable() {
                @Override public void run() {
                    Mdns.browse(cfg.nif, 3500, cancel, new Mdns.Handler() {
                        @Override public void onMessage(String fromIp, DnsPacket.Message msg) {
                            onMdns(fromIp, msg);
                        }
                    });
                }
            }));
        }
        if (cfg.ssdp) sweeps.add(bg("ssdp", new Runnable() {
            @Override public void run() {
                Ssdp.discover(cfg.nif, 3500, cancel, new Ssdp.Handler() {
                    @Override public void onReply(String fromIp, String location, String server) {
                        Device d = device(fromIp);
                        if (d == null) return;
                        d.markAlive("UPnP");
                        if (location != null && !ssdpLocations.containsKey(fromIp) && location.startsWith("http://"))
                            ssdpLocations.put(fromIp, location);
                        if (server != null) synchronized (d) {
                            if (!d.banners.containsKey(1900)) d.banners.put(1900, server);
                        }
                        emit(d);
                    }
                });
            }
        }));

        final int total = cfg.targets.size();
        final AtomicInteger done = new AtomicInteger();
        pool = Executors.newFixedThreadPool(Math.max(1, Math.min(cfg.threads, total)));
        for (final long v : cfg.targets) {
            pool.execute(new Runnable() {
                @Override public void run() {
                    if (cancel.get()) return;
                    probeHost(v);
                    int n = done.incrementAndGet();
                    if (n == total || n % 4 == 0) listener.onProgress(n, total);
                }
            });
        }
        awaitPool();
        for (Thread t : sweeps) join(t);
        if (cancel.get()) return;

        // Neighbour table (works up to Android 9, and on rooted / older ROMs).
        Map<String, String> arp = ArpTable.read();
        for (Map.Entry<String, String> e : arp.entrySet()) {
            Device d = device(e.getKey());
            if (d == null) continue;
            boolean wasAlive = d.alive;
            d.markAlive("ARP");
            synchronized (d) {
                d.mac = e.getValue();
            }
            if (!wasAlive) emit(d);
        }
    }

    private void probeHost(long v) {
        try {
            String ip = IpUtils.toIp(v);
            InetAddress addr = InetAddress.getByAddress(IpUtils.toBytes(v));
            int rtt = Pinger.isReachable(addr, cfg.pingTimeoutMs);
            if (cancel.get()) return;
            if (rtt >= 0) {
                Device d = device(ip);
                if (d == null) return;
                d.markAlive("ICMP");
                synchronized (d) {
                    if (d.rttMs < 0 || rtt < d.rttMs) d.rttMs = rtt;
                }
                emit(d);
                return;
            }
            TcpProbe.Result r = TcpProbe.probe(addr, Ports.ALIVE_PROBE, 0, Ports.ALIVE_PROBE.length, cfg.tcpTimeoutMs, cancel);
            if (r.responded) {
                Device d = device(ip);
                if (d == null) return;
                d.markAlive("TCP");
                synchronized (d) {
                    for (int p : r.open) d.openPorts.add(p);
                    if (d.rttMs < 0) d.rttMs = r.firstResponseMs;
                }
                emit(d);
            }
        } catch (Exception ignored) {
        }
    }

    private void onNetBios(String ip, NetBios.Info info) {
        if (info == null) return;
        Device d = device(ip);
        if (d == null) return;
        d.markAlive("NetBIOS");
        synchronized (d) {
            if (info.name != null) d.netbiosName = info.name;
            if (info.group != null) d.workgroup = info.group;
            if (info.user != null) d.netbiosUser = info.user;
            if (info.mac != null && d.mac == null) d.mac = info.mac;
        }
        emit(d);
    }

    void onMdns(String fromIp, DnsPacket.Message msg) {
        if (!msg.response) return;
        Device src = device(fromIp);
        String srcHost = null;
        for (DnsPacket.Record r : msg.records) {
            if (r.type == DnsPacket.TYPE_A && r.data != null && r.name != null && r.name.endsWith(".local")) {
                Device d = device(r.data);
                if (d != null) {
                    d.markAlive("mDNS");
                    synchronized (d) {
                        if (d.mdnsName == null) d.mdnsName = r.name;
                    }
                    if (r.data.equals(fromIp)) srcHost = r.name;
                    emit(d);
                }
            } else if (r.type == DnsPacket.TYPE_PTR && r.name != null && r.name.endsWith(".in-addr.arpa") && r.data != null) {
                String ip = ipFromReverse(r.name);
                Device d = device(ip);
                if (d != null) {
                    d.markAlive("mDNS");
                    synchronized (d) {
                        if (d.mdnsName == null) d.mdnsName = r.data;
                    }
                    emit(d);
                }
            }
        }
        if (src == null) return;
        src.markAlive("mDNS");
        synchronized (src) {
            if (src.mdnsName == null && srcHost != null) src.mdnsName = srcHost;
            for (DnsPacket.Record r : msg.records) {
                if (r.type == DnsPacket.TYPE_PTR && r.name != null && r.name.startsWith("_") && r.data != null
                        && !r.name.startsWith("_services._dns-sd")) {
                    String type = Mdns.serviceTypeOf(r.data);
                    if (type != null) src.services.add(type);
                    applyInstanceName(src, type, Mdns.instanceLabel(r.data));
                } else if (r.type == DnsPacket.TYPE_TXT && r.name != null) {
                    String type = Mdns.serviceTypeOf(r.name);
                    applyTxt(src, type == null ? "" : type, r.txt);
                } else if (r.type == DnsPacket.TYPE_SRV && r.name != null) {
                    String type = Mdns.serviceTypeOf(r.name);
                    if (type != null) src.services.add(type);
                    applyInstanceName(src, type, Mdns.instanceLabel(r.name));
                    if (src.mdnsName == null && r.data != null && r.data.endsWith(".local")) src.mdnsName = r.data;
                }
            }
        }
        emit(src);
    }

    private static void applyInstanceName(Device d, String type, String label) {
        if (type == null || label == null || label.isEmpty()) return;
        if (type.equals("_workstation._tcp")) {
            Matcher m = MAC_IN_TEXT.matcher(label);
            if (m.find() && d.mac == null) d.mac = IpUtils.normalizeMac(m.group(1));
            return;
        }
        if (type.equals("_raop._tcp")) {
            int at = label.indexOf('@');
            if (at >= 0) {
                if (d.mac == null) d.mac = IpUtils.normalizeMac(label.substring(0, at));
                label = label.substring(at + 1);
            }
        }
        boolean strong = type.equals("_companion-link._tcp") || type.equals("_device-info._tcp") || type.equals("_airplay._tcp")
                || type.equals("_raop._tcp") || type.equals("_smb._tcp") || type.equals("_afpovertcp._tcp")
                || type.startsWith("_ipp") || type.equals("_printer._tcp") || type.equals("_hap._tcp") || type.equals("_sonos._tcp");
        if (strong && d.friendlyName == null && !label.matches("(?i)[0-9a-f-]{20,}")) d.friendlyName = label;
    }

    private static void applyTxt(Device d, String type, List<String> txt) {
        String fn = DnsPacket.txtValue(txt, "fn");
        if (fn != null && !fn.isEmpty()) d.friendlyName = fn; // Google Cast friendly name wins
        String model = firstNonNull(DnsPacket.txtValue(txt, "md"), DnsPacket.txtValue(txt, "model"),
                DnsPacket.txtValue(txt, "ty"), DnsPacket.txtValue(txt, "usb_MDL"), DnsPacket.txtValue(txt, "am"));
        if (model != null && !model.isEmpty() && d.model == null) d.model = model;
        String mfg = firstNonNull(DnsPacket.txtValue(txt, "usb_MFG"), DnsPacket.txtValue(txt, "manufacturer"));
        if (mfg != null && d.manufacturer == null) d.manufacturer = mfg;
        String mac = firstNonNull(DnsPacket.txtValue(txt, "deviceid"), DnsPacket.txtValue(txt, "mac"));
        if (mac != null && d.mac == null) d.mac = IpUtils.normalizeMac(mac);
        if (type.startsWith("_device-info") && model != null && d.os == null && model.toLowerCase(Locale.US).contains("mac"))
            d.os = "macOS";
    }

    private static String firstNonNull(String... v) {
        for (String s : v) if (s != null && !s.trim().isEmpty()) return s.trim();
        return null;
    }

    static String ipFromReverse(String name) {
        String[] p = name.split("\\.");
        if (p.length < 6) return null;
        return p[3] + "." + p[2] + "." + p[1] + "." + p[0];
    }

    // ---------------------------------------------------------------- stage 2

    private void identify() {
        final List<Device> alive = new ArrayList<>();
        for (Device d : devices.values()) if (d.alive) alive.add(d);
        Collections.sort(alive, new Comparator<Device>() {
            @Override public int compare(Device a, Device b) {
                return Long.compare(a.ipLong, b.ipLong);
            }
        });
        listener.onStage("Identifying " + alive.size() + " devices");
        listener.onProgress(0, alive.size());

        Thread dns = cfg.reverseDns ? bg("rdns", new Runnable() {
            @Override public void run() {
                reverseDns(alive);
            }
        }) : null;

        pool = Executors.newFixedThreadPool(Math.max(1, Math.min(cfg.threads / 2, Math.max(1, alive.size()))));
        final AtomicInteger done = new AtomicInteger();
        for (final Device d : alive) {
            pool.execute(new Runnable() {
                @Override public void run() {
                    if (cancel.get()) return;
                    try {
                        identifyHost(d);
                    } catch (Exception ignored) {
                    }
                    listener.onProgress(done.incrementAndGet(), alive.size());
                    emit(d);
                }
            });
        }
        awaitPool();
        if (dns != null) join(dns);
        for (Device d : alive) {
            synchronized (d) {
                if (d.mac != null) d.vendor = cfg.oui.lookup(d.mac);
            }
            Classifier.classify(d);
            emit(d);
        }
    }

    private void reverseDns(final List<Device> alive) {
        if (alive.isEmpty()) return;
        final List<Long> ips = new ArrayList<>();
        for (Device d : alive) ips.add(d.ipLong);
        List<String> servers = new ArrayList<>(cfg.dnsServers);
        if (cfg.gatewayIp != null && !servers.contains(cfg.gatewayIp)) servers.add(cfg.gatewayIp);
        for (String server : servers) {
            if (cancel.get()) return;
            final InetAddress srv;
            try {
                if (!IpUtils.isIpv4(server)) continue;
                srv = InetAddress.getByName(server);
            } catch (Exception e) {
                continue;
            }
            final AtomicInteger answered = new AtomicInteger();
            UdpSweep.run(ips, 53, srv, new UdpSweep.Payload() {
                @Override public byte[] build(int index, long ip) {
                    return DnsPacket.query(index & 0xFFFF, IpUtils.reverseName(IpUtils.toIp(ip)), DnsPacket.TYPE_PTR, false, true);
                }
            }, 1200, cancel, new UdpSweep.ReplyHandler() {
                @Override public void onReply(String fromIp, byte[] data, int len) {
                    DnsPacket.Message m = DnsPacket.parse(data, len);
                    if (!m.response || m.id >= ips.size()) return;
                    for (DnsPacket.Record r : m.records) {
                        if (r.type != DnsPacket.TYPE_PTR || r.data == null || r.data.isEmpty()) continue;
                        Device d = device(IpUtils.toIp(ips.get(m.id)));
                        if (d == null) continue;
                        answered.incrementAndGet();
                        synchronized (d) {
                            if (d.hostname == null) d.hostname = r.data;
                        }
                        emit(d);
                        break;
                    }
                }
            });
            if (answered.get() > 0) return; // first server that knows the LAN is enough
        }
    }

    private void identifyHost(Device d) {
        String ip = d.ip;
        if (cfg.scanServices && cfg.servicePorts.length > 0) {
            try {
                InetAddress addr = InetAddress.getByAddress(IpUtils.toBytes(d.ipLong));
                for (int i = 0; i < cfg.servicePorts.length && !cancel.get(); i += 256) {
                    TcpProbe.Result r = TcpProbe.probe(addr, cfg.servicePorts, i, Math.min(cfg.servicePorts.length, i + 256),
                            cfg.tcpTimeoutMs + 300, cancel);
                    synchronized (d) {
                        for (int p : r.open) d.openPorts.add(p);
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (cancel.get()) return;
        emit(d);
        List<Integer> ports;
        synchronized (d) {
            ports = new ArrayList<>(d.openPorts);
        }
        for (int p : new int[]{22, 21, 23, 25}) {
            if (!ports.contains(p) || cancel.get()) continue;
            String b = TcpProbe.grabBanner(ip, p, 1500);
            if (b != null) synchronized (d) {
                d.banners.put(p, b);
                if (p == 22) d.sshBanner = b;
            }
        }
        if (cfg.httpInfo) {
            int tried = 0;
            for (int p : ports) {
                if (tried >= 3 || cancel.get()) break;
                if (Ports.isHttp(p)) {
                    tried++;
                    HttpProbe.Response r = HttpProbe.fetchRoot(ip, p, 2000);
                    if (r != null) synchronized (d) {
                        if (r.title != null && d.httpTitle == null) d.httpTitle = r.title;
                        if (r.server != null && d.httpServer == null) d.httpServer = r.server;
                        String summary = "HTTP " + r.status + (r.server != null ? " · " + r.server : "")
                                + (r.title != null ? " · " + r.title : "");
                        d.banners.put(p, summary);
                    }
                } else if (Ports.isHttps(p)) {
                    tried++;
                    String cn = HttpProbe.tlsCertificateName(ip, p, 2000);
                    if (cn != null) synchronized (d) {
                        d.banners.put(p, "TLS certificate: " + cn);
                    }
                }
            }
        }
        String loc = ssdpLocations.get(ip);
        if (loc != null && !cancel.get()) {
            Ssdp.Description desc = Ssdp.fetchDescription(loc, 2500);
            if (desc != null) synchronized (d) {
                if (desc.friendlyName != null && d.friendlyName == null) d.friendlyName = desc.friendlyName;
                if (desc.manufacturer != null && d.manufacturer == null) d.manufacturer = desc.manufacturer;
                String model = desc.modelName;
                if (model != null && desc.modelNumber != null && !model.contains(desc.modelNumber)) model += " " + desc.modelNumber;
                if (model != null && d.model == null) d.model = model;
                String t = Ssdp.shortDeviceType(desc.deviceType);
                if (t != null) d.services.add("upnp:" + t);
            }
        }
    }

    // ---------------------------------------------------------------- utils

    private void awaitPool() {
        ExecutorService p = pool;
        p.shutdown();
        try {
            while (!p.awaitTermination(200, TimeUnit.MILLISECONDS)) {
                if (cancel.get()) {
                    p.shutdownNow();
                    p.awaitTermination(3, TimeUnit.SECONDS);
                    break;
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static Thread bg(String name, Runnable r) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        t.start();
        return t;
    }

    private static void join(Thread t) {
        try {
            t.join(15000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
