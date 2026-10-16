package com.ahuva.ipfinder.ui;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.ahuva.ipfinder.core.Device;
import com.ahuva.ipfinder.core.IpUtils;
import com.ahuva.ipfinder.core.Pinger;
import com.ahuva.ipfinder.core.Ports;
import com.ahuva.ipfinder.core.TcpProbe;
import com.ahuva.ipfinder.core.Traceroute;
import com.ahuva.ipfinder.core.WakeOnLan;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Ping, traceroute, port scanner, Wake-on-LAN, DNS lookup, network info and subnet calculator. */
public class ToolsActivity extends Activity {
    public static final String PING = "ping", TRACE = "trace", PORTS = "ports", WOL = "wol", DNS = "dns", NETINFO = "netinfo", SUBNET = "subnet";
    private static final String[][] TOOLS = {
            {PING, "Ping"}, {TRACE, "Traceroute"}, {PORTS, "Port scan"}, {WOL, "Wake-on-LAN"},
            {DNS, "DNS lookup"}, {NETINFO, "Network info"}, {SUBNET, "Subnet calc"}};
    private static final int REQ_LOCATION = 3;

    private String tool = PING;
    private String initialHost;
    private LinearLayout tabs, form;
    private TextView output;
    private ScrollView outScroll;
    private Button runButton;
    private final AtomicBoolean cancel = new AtomicBoolean();
    private volatile boolean running;
    private Thread worker;
    private String runLabel = "Run";

    public static void open(Context c, String tool, String host) {
        Intent i = new Intent(c, ToolsActivity.class).putExtra("tool", tool);
        if (host != null) i.putExtra("host", host);
        c.startActivity(i);
    }

    @Override protected void onCreate(Bundle state) {
        Ui.applyTheme(this);
        super.onCreate(state);
        String t = getIntent().getStringExtra("tool");
        if (t != null) tool = t;
        if (state != null) tool = state.getString("tool", tool);
        initialHost = getIntent().getStringExtra("host");
        FrameLayout content = Ui.setupScreen(this, "Tools", true);
        LinearLayout col = Ui.column(this);
        content.addView(col);

        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        hs.setBackgroundColor(Ui.surface(this));
        tabs = Ui.row(this);
        tabs.setPadding(Ui.dp(this, 12), Ui.dp(this, 10), Ui.dp(this, 4), Ui.dp(this, 10));
        hs.addView(tabs);
        col.addView(hs, Ui.matchWrap());

        form = Ui.column(this);
        form.setPadding(Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12), 0);
        col.addView(form, Ui.matchWrap());

        outScroll = new ScrollView(this);
        output = Ui.mono(this, "", 13, Ui.textPrimary(this));
        output.setTextIsSelectable(true);
        output.setPadding(Ui.dp(this, 14), Ui.dp(this, 12), Ui.dp(this, 14), Ui.dp(this, 24));
        outScroll.addView(output);
        LinearLayout.LayoutParams op = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        op.setMargins(Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12));
        outScroll.setBackground(Ui.round(Ui.surface(this), Ui.dp(this, 14)));
        col.addView(outScroll, op);
        showTool(tool);
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("tool", tool);
    }

    @Override protected void onDestroy() {
        super.onDestroy();
        stop();
    }

    private void buildTabs() {
        tabs.removeAllViews();
        for (final String[] t : TOOLS) {
            TextView chip = Ui.chip(this, t[1], t[0].equals(tool));
            chip.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    if (running) stop();
                    showTool(t[0]);
                }
            });
            tabs.addView(chip, Ui.margins(Ui.wrap(), this, 0, 0, 8, 0));
        }
    }

    private void showTool(String t) {
        tool = t;
        buildTabs();
        form.removeAllViews();
        output.setText("");
        switch (t) {
            case TRACE: traceForm(); break;
            case PORTS: portsForm(); break;
            case WOL: wolForm(); break;
            case DNS: dnsForm(); break;
            case NETINFO: netInfo(); break;
            case SUBNET: subnetForm(); break;
            default: pingForm(); break;
        }
    }

    // ------------------------------------------------------------------ building blocks

    private EditText field(String hint, String value, int type) {
        EditText e = Ui.input(this, hint, type);
        if (value != null) e.setText(value);
        return e;
    }

    private String defaultHost() {
        if (initialHost != null) return initialHost;
        List<NetInfo.Iface> l = NetInfo.interfaces(this);
        for (NetInfo.Iface f : l) if (f.gateway != null) return f.gateway;
        return "8.8.8.8";
    }

    private Button runRow(LinearLayout row, final Runnable task) {
        runLabel = "Run";
        runButton = Ui.button(this, runLabel, true);
        runButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (running) {
                    stop();
                } else {
                    hideKeyboard();
                    task.run();
                }
            }
        });
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(Ui.dp(this, 84), Ui.dp(this, 46));
        p.leftMargin = Ui.dp(this, 8);
        row.addView(runButton, p);
        return runButton;
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        View f = getCurrentFocus();
        if (imm != null && f != null) imm.hideSoftInputFromWindow(f.getWindowToken(), 0);
    }

    private void print(final String line) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                output.append(line + "\n");
                outScroll.post(new Runnable() {
                    @Override public void run() {
                        outScroll.fullScroll(View.FOCUS_DOWN);
                    }
                });
            }
        });
    }

    private void setRunLabel(String s) {
        runLabel = s;
        if (runButton != null && !running) runButton.setText(s);
    }

    private void startJob(final Runnable job) {
        startJob(job, true);
    }

    private void startJob(final Runnable job, boolean clear) {
        if (clear) output.setText("");
        cancel.set(false);
        running = true;
        runButton.setText("Stop");
        Ui.ripple(runButton, Ui.DANGER, Ui.dp(this, 12));
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        worker = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    job.run();
                } catch (Exception e) {
                    print("Error: " + e.getMessage());
                }
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        running = false;
                        if (runButton != null) {
                            runButton.setText(runLabel);
                            Ui.ripple(runButton, Ui.BRAND, Ui.dp(ToolsActivity.this, 12));
                        }
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                });
            }
        }, "tool-" + tool);
        worker.start();
    }

    private void stop() {
        cancel.set(true);
        if (worker != null) worker.interrupt();
    }

    // ------------------------------------------------------------------ ping

    private void pingForm() {
        LinearLayout r = Ui.row(this);
        final EditText host = field("Host or IP", defaultHost(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        r.addView(host, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));
        final EditText count = field("Count", "10", InputType.TYPE_CLASS_NUMBER);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(Ui.dp(this, 64), Ui.dp(this, 46));
        cp.leftMargin = Ui.dp(this, 8);
        r.addView(count, cp);
        runRow(r, new Runnable() {
            @Override public void run() {
                final String h = host.getText().toString().trim();
                int n;
                try {
                    n = Integer.parseInt(count.getText().toString().trim());
                } catch (NumberFormatException e) {
                    n = 10;
                }
                final int total = n;
                startJob(new Runnable() {
                    @Override public void run() {
                        ping(h, total);
                    }
                });
            }
        });
        form.addView(r, Ui.matchWrap());
        form.addView(hint("Count 0 = continuous until Stop. Uses ICMP echo (system ping)."));
    }

    private TextView hint(String s) {
        TextView t = Ui.text(this, s, 12, Ui.textSecondary(this), false);
        t.setPadding(Ui.dp(this, 4), Ui.dp(this, 6), 0, 0);
        return t;
    }

    private void ping(String host, int count) {
        String ip;
        try {
            ip = InetAddress.getByName(host).getHostAddress();
        } catch (Exception e) {
            print("Cannot resolve " + host);
            return;
        }
        print("PING " + host + (ip.equals(host) ? "" : " (" + ip + ")"));
        int sent = 0, recv = 0;
        double min = Double.MAX_VALUE, max = 0, sum = 0;
        while (!cancel.get() && (count <= 0 || sent < count)) {
            long t0 = System.currentTimeMillis();
            Pinger.Reply r = Pinger.once(ip, 2, 0);
            sent++;
            if (r.ok) {
                recv++;
                double ms = r.rttMs >= 0 ? r.rttMs : (System.currentTimeMillis() - t0);
                min = Math.min(min, ms);
                max = Math.max(max, ms);
                sum += ms;
                print(String.format(Locale.US, "#%d  reply from %s  time=%.1f ms", sent, ip, ms));
            } else if (r.line != null && r.line.startsWith("ping unavailable")) {
                // No ping binary: fall back to InetAddress.isReachable.
                try {
                    int ms = Pinger.isReachable(InetAddress.getByName(ip), 2000);
                    if (ms >= 0) {
                        recv++;
                        min = Math.min(min, ms);
                        max = Math.max(max, ms);
                        sum += ms;
                        print("#" + sent + "  reply from " + ip + "  time=" + ms + " ms");
                    } else {
                        print("#" + sent + "  request timed out");
                    }
                } catch (Exception e) {
                    print("#" + sent + "  error " + e.getMessage());
                }
            } else {
                print("#" + sent + "  request timed out");
            }
            long wait = 1000 - (System.currentTimeMillis() - t0);
            if (wait > 0 && !cancel.get()) {
                try {
                    Thread.sleep(wait);
                } catch (InterruptedException e) {
                    break;
                }
            }
        }
        print("");
        print(String.format(Locale.US, "%d sent, %d received, %.0f%% loss", sent, recv, sent == 0 ? 0 : 100.0 * (sent - recv) / sent));
        if (recv > 0) print(String.format(Locale.US, "rtt min/avg/max = %.1f / %.1f / %.1f ms", min, sum / recv, max));
    }

    // ------------------------------------------------------------------ traceroute

    private void traceForm() {
        LinearLayout r = Ui.row(this);
        final EditText host = field("Host or IP", initialHost != null ? initialHost : "8.8.8.8", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        r.addView(host, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));
        runRow(r, new Runnable() {
            @Override public void run() {
                final String h = host.getText().toString().trim();
                startJob(new Runnable() {
                    @Override public void run() {
                        print("Traceroute to " + h + " (max 30 hops)");
                        boolean ok = Traceroute.run(h, 30, cancel, new Traceroute.Listener() {
                            @Override public void onHop(int ttl, String ip, String name, double rttMs) {
                                if (ip == null) print(String.format(Locale.US, "%2d  *", ttl));
                                else print(String.format(Locale.US, "%2d  %-15s %s%s", ttl, ip, rttMs >= 0 ? String.format(Locale.US, "%.0f ms", rttMs) : "",
                                        name != null ? "  " + name : ""));
                            }
                        });
                        print(ok ? "Destination reached." : cancel.get() ? "Stopped." : "Destination not reached.");
                    }
                });
            }
        });
        form.addView(r, Ui.matchWrap());
        form.addView(hint("Hops that don't answer ICMP show as *."));
    }

    // ------------------------------------------------------------------ port scan

    private void portsForm() {
        LinearLayout r = Ui.row(this);
        final EditText host = field("Host or IP", defaultHost(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        r.addView(host, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));
        form.addView(r, Ui.matchWrap());
        LinearLayout r2 = Ui.row(this);
        r2.setPadding(0, Ui.dp(this, 8), 0, 0);
        final EditText ports = field("Ports: 1-1024, 3389, 8000-8100", initialHost != null ? "1-65535" : "1-1024",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        r2.addView(ports, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));
        runRow(r2, new Runnable() {
            @Override public void run() {
                final String h = host.getText().toString().trim();
                final String spec = ports.getText().toString().trim();
                startJob(new Runnable() {
                    @Override public void run() {
                        portScan(h, spec);
                    }
                });
            }
        });
        form.addView(r2, Ui.matchWrap());
        LinearLayout presets = Ui.row(this);
        presets.setPadding(0, Ui.dp(this, 8), 0, 0);
        String[][] ps = {{"Common", Ports.DEFAULT_SERVICE_PORTS}, {"1-1024", "1-1024"}, {"All 65535", "1-65535"}};
        for (final String[] p : ps) {
            TextView c = Ui.chip(this, p[0], false);
            c.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    ports.setText(p[1]);
                }
            });
            presets.addView(c, Ui.margins(Ui.wrap(), this, 0, 0, 8, 0));
        }
        form.addView(presets);
    }

    private void portScan(String host, String spec) {
        final int[] ports;
        try {
            ports = Ports.parse(spec);
        } catch (IllegalArgumentException e) {
            print(e.getMessage());
            return;
        }
        if (ports.length == 0) {
            print("No ports to scan");
            return;
        }
        final InetAddress addr;
        try {
            addr = InetAddress.getByName(host);
        } catch (Exception e) {
            print("Cannot resolve " + host);
            return;
        }
        final String ip = addr.getHostAddress();
        print("Scanning " + ports.length + " TCP ports on " + ip + " …");
        long t0 = System.currentTimeMillis();
        final int timeout = Math.max(600, Prefs.get(this).tcpTimeout());
        final List<Integer> open = Collections.synchronizedList(new ArrayList<Integer>());
        final AtomicInteger done = new AtomicInteger();
        final int batch = 256;
        ExecutorService pool = Executors.newFixedThreadPool(4);
        for (int i = 0; i < ports.length; i += batch) {
            final int from = i, to = Math.min(ports.length, i + batch);
            pool.execute(new Runnable() {
                @Override public void run() {
                    if (cancel.get()) return;
                    TcpProbe.Result r = TcpProbe.probe(addr, ports, from, to, timeout, cancel);
                    for (int p : r.open) {
                        open.add(p);
                        print(String.format(Locale.US, "  %5d/tcp  open   %s", p, Ports.name(p)));
                    }
                    int d = done.addAndGet(to - from);
                    if (ports.length > 2000 && (d / batch) % 20 == 0) print(String.format(Locale.US, "  … %d%%", 100 * d / ports.length));
                }
            });
        }
        pool.shutdown();
        try {
            while (!pool.awaitTermination(200, TimeUnit.MILLISECONDS)) {
                if (cancel.get()) {
                    pool.shutdownNow();
                    break;
                }
            }
        } catch (InterruptedException e) {
            pool.shutdownNow();
        }
        Collections.sort(open);
        print("");
        print(open.size() + " open port" + (open.size() == 1 ? "" : "s") + " in " + (System.currentTimeMillis() - t0) / 1000.0 + "s"
                + (cancel.get() ? " (stopped)" : ""));
        if (!open.isEmpty()) print("Open: " + open);
        // Feed results back into the device, if it is in the current scan.
        Device d = ScanSession.get(this).find(ip);
        if (d != null && !cancel.get()) {
            synchronized (d) {
                d.openPorts.addAll(open);
            }
            ScanSession.get(this).userDataChanged();
        }
    }

    // ------------------------------------------------------------------ wake on lan

    private void wolForm() {
        final EditText mac = field("MAC address, e.g. AA:BB:CC:DD:EE:FF", null, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        form.addView(mac, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 46)));
        LinearLayout r = Ui.row(this);
        r.setPadding(0, Ui.dp(this, 8), 0, 0);
        String bcast = "255.255.255.255";
        for (NetInfo.Iface f : NetInfo.interfaces(this)) {
            if (!"Mobile data".equals(f.kind)) {
                bcast = f.broadcast();
                break;
            }
        }
        final EditText to = field("Broadcast or IP", bcast, InputType.TYPE_CLASS_TEXT);
        r.addView(to, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));
        final EditText port = field("Port", "9", InputType.TYPE_CLASS_NUMBER);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(Ui.dp(this, 64), Ui.dp(this, 46));
        pp.leftMargin = Ui.dp(this, 8);
        r.addView(port, pp);
        runRow(r, new Runnable() {
            @Override public void run() {
                final String m = mac.getText().toString().trim(), dst = to.getText().toString().trim();
                int p;
                try {
                    p = Integer.parseInt(port.getText().toString().trim());
                } catch (NumberFormatException e) {
                    p = 9;
                }
                final int pt = p;
                startJob(new Runnable() {
                    @Override public void run() {
                        try {
                            WakeOnLan.send(m, dst, pt);
                            print("Magic packet sent to " + IpUtils.normalizeMac(m) + " via " + dst + ":" + pt);
                            print("The target must have Wake-on-LAN enabled in BIOS/UEFI and on its network adapter.");
                        } catch (Exception e) {
                            print("Failed: " + e.getMessage());
                        }
                    }
                });
            }
        });
        setRunLabel("Wake");
        form.addView(r, Ui.matchWrap());
        // Known MACs from the last scan and favorites.
        LinearLayout known = Ui.row(this);
        List<Device> list = new ArrayList<>(ScanSession.get(this).snapshot());
        list.addAll(Store.get(this).favorites());
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (final Device d : list) {
            if (d.mac == null || IpUtils.isRandomizedMac(d.mac) || !seen.add(d.mac)) continue;
            String label = d.displayName().isEmpty() ? d.ip : d.displayName();
            TextView c = Ui.chip(this, label, false);
            c.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    mac.setText(d.mac);
                }
            });
            known.addView(c, Ui.margins(Ui.wrap(), this, 0, 0, 8, 0));
        }
        if (known.getChildCount() > 0) {
            HorizontalScrollView hs = new HorizontalScrollView(this);
            hs.setHorizontalScrollBarEnabled(false);
            hs.addView(known);
            form.addView(hs, Ui.margins(Ui.matchWrap(), this, 0, 8, 0, 0));
        }
    }

    // ------------------------------------------------------------------ dns

    private void dnsForm() {
        LinearLayout r = Ui.row(this);
        final EditText host = field("Hostname or IP", initialHost != null ? initialHost : "example.com",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        r.addView(host, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));
        runRow(r, new Runnable() {
            @Override public void run() {
                final String h = host.getText().toString().trim();
                startJob(new Runnable() {
                    @Override public void run() {
                        long t0 = System.currentTimeMillis();
                        try {
                            if (IpUtils.isIpv4(h)) {
                                String n = InetAddress.getByName(h).getCanonicalHostName();
                                print("Reverse lookup " + h);
                                print(n.equals(h) ? "  no PTR record" : "  " + n);
                            } else {
                                print("Lookup " + h);
                                for (InetAddress a : InetAddress.getAllByName(h))
                                    print("  " + (a instanceof Inet4Address ? "A     " : "AAAA  ") + a.getHostAddress());
                            }
                        } catch (Exception e) {
                            print("  not found (" + e.getClass().getSimpleName() + ")");
                        }
                        print("  " + (System.currentTimeMillis() - t0) + " ms");
                    }
                });
            }
        });
        form.addView(r, Ui.matchWrap());
    }

    // ------------------------------------------------------------------ network info

    private void netInfo() {
        LinearLayout r = Ui.row(this);
        Button refresh = Ui.button(this, "Refresh", false);
        refresh.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                showNetInfo(false);
            }
        });
        r.addView(refresh, Ui.margins(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 44)), this, 0, 0, 8, 0));
        runLabel = "Public IP";
        runButton = Ui.button(this, runLabel, true);
        runButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                showNetInfo(true);
            }
        });
        r.addView(runButton, Ui.margins(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 44)), this, 0, 0, 8, 0));
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Button perm = Ui.button(this, "Show Wi-Fi name", false);
            perm.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            });
            r.addView(perm, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 44)));
        }
        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.addView(r);
        form.addView(hs, Ui.matchWrap());
        showNetInfo(false);
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == REQ_LOCATION && NETINFO.equals(tool)) showTool(NETINFO);
    }

    private void showNetInfo(final boolean publicIp) {
        output.setText("");
        NetInfo.Wifi w = NetInfo.wifi(this);
        if (w != null) {
            print("Wi-Fi");
            print("  SSID       " + (w.ssid != null ? w.ssid : "(hidden - allow location to show)"));
            if (w.bssid != null) print("  BSSID      " + w.bssid);
            print("  Signal     " + w.rssi + " dBm (" + NetInfo.signal(w.rssi) + ")");
            print("  Link       " + w.linkMbps + " Mbps  " + NetInfo.band(w.freqMhz) + (w.freqMhz > 0 ? " (" + w.freqMhz + " MHz)" : ""));
            print("");
        }
        List<NetInfo.Iface> l = NetInfo.interfaces(this);
        if (l.isEmpty()) print("No active IPv4 network.");
        for (NetInfo.Iface f : l) {
            print(f.kind + "  (" + f.name + ")");
            print("  IP         " + f.ip + "/" + f.prefix);
            print("  Netmask    " + IpUtils.toIp(IpUtils.maskOf(f.prefix)));
            print("  Range      " + IpUtils.cidrToRange(f.ip, f.prefix));
            print("  Broadcast  " + f.broadcast());
            if (f.gateway != null) print("  Gateway    " + f.gateway);
            if (!f.dns.isEmpty()) print("  DNS        " + android.text.TextUtils.join(", ", f.dns));
            print("");
        }
        if (publicIp) {
            if (running) return;
            print("Looking up public IP…");
            startJob(new Runnable() {
                @Override public void run() {
                    print("Public IP   " + fetchPublicIp());
                }
            }, false);
        }
    }

    private static String fetchPublicIp() {
        String[] urls = {"https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"};
        for (String u : urls) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(u).openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(5000);
                c.setRequestProperty("User-Agent", "AhuvaIPFinder");
                BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream()));
                String line = br.readLine();
                br.close();
                if (line != null && !line.trim().isEmpty()) return line.trim();
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return "unavailable (no internet?)";
    }

    // ------------------------------------------------------------------ subnet calculator

    private void subnetForm() {
        LinearLayout r = Ui.row(this);
        String def = "192.168.1.10/24";
        for (NetInfo.Iface f : NetInfo.interfaces(this)) {
            def = f.ip + "/" + f.prefix;
            break;
        }
        final EditText in = field("IP/prefix or IP mask", def, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        r.addView(in, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));
        runRow(r, new Runnable() {
            @Override public void run() {
                calc(in.getText().toString().trim());
            }
        });
        setRunLabel("Calc");
        form.addView(r, Ui.matchWrap());
        form.addView(hint("Examples: 10.1.2.3/20  ·  172.16.5.4 255.255.252.0"));
        calc(def);
    }

    private void calc(String s) {
        output.setText("");
        try {
            String[] p = s.trim().split("[/\\s]+");
            if (p.length < 2) throw new IllegalArgumentException("Use IP/prefix, e.g. 192.168.1.10/24");
            long ip = IpUtils.toLong(p[0]);
            int prefix = p[1].contains(".") ? IpUtils.prefixOf(p[1]) : Integer.parseInt(p[1]);
            if (prefix < 0 || prefix > 32) throw new IllegalArgumentException("Prefix must be 0-32");
            long mask = IpUtils.maskOf(prefix);
            long net = ip & mask, bc = net | (~mask & 0xFFFFFFFFL);
            long hosts = prefix >= 31 ? (1L << (32 - prefix)) : (1L << (32 - prefix)) - 2;
            long first = prefix >= 31 ? net : net + 1, last = prefix >= 31 ? bc : bc - 1;
            long a = ip >> 24;
            String cls = a < 128 ? "A" : a < 192 ? "B" : a < 224 ? "C" : a < 240 ? "D (multicast)" : "E";
            output.append("Address     " + IpUtils.toIp(ip) + "\n");
            output.append("Netmask     " + IpUtils.toIp(mask) + "  = /" + prefix + "\n");
            output.append("Wildcard    " + IpUtils.toIp(~mask & 0xFFFFFFFFL) + "\n");
            output.append("Network     " + IpUtils.toIp(net) + "/" + prefix + "\n");
            output.append("Broadcast   " + IpUtils.toIp(bc) + "\n");
            output.append("First host  " + IpUtils.toIp(first) + "\n");
            output.append("Last host   " + IpUtils.toIp(last) + "\n");
            output.append("Hosts       " + hosts + "\n");
            output.append("Class       " + cls + (IpUtils.isPrivate(ip) ? ", private" : ", public") + "\n");
            output.append("Binary mask " + binary(mask) + "\n");
        } catch (Exception e) {
            output.setText(e.getMessage() != null ? e.getMessage() : "Invalid input");
        }
    }

    private static String binary(long v) {
        StringBuilder sb = new StringBuilder();
        for (int i = 31; i >= 0; i--) {
            sb.append((v >> i) & 1);
            if (i % 8 == 0 && i > 0) sb.append('.');
        }
        return sb.toString();
    }
}
