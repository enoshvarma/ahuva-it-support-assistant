package com.ahuva.ipfinder.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.ahuva.ipfinder.core.Classifier;
import com.ahuva.ipfinder.core.Device;
import com.ahuva.ipfinder.core.DeviceType;
import com.ahuva.ipfinder.core.Exporter;
import com.ahuva.ipfinder.core.HttpProbe;
import com.ahuva.ipfinder.core.IpUtils;
import com.ahuva.ipfinder.core.Pinger;
import com.ahuva.ipfinder.core.Ports;
import com.ahuva.ipfinder.core.TcpProbe;
import com.ahuva.ipfinder.core.WakeOnLan;

import java.net.InetAddress;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

public class DeviceActivity extends Activity implements ScanSession.Observer {
    private Device d;
    private LinearLayout body;
    private volatile boolean busy;

    public static void open(Context c, String ip) {
        c.startActivity(new Intent(c, DeviceActivity.class).putExtra("ip", ip));
    }

    @Override protected void onCreate(Bundle state) {
        Ui.applyTheme(this);
        super.onCreate(state);
        String ip = getIntent().getStringExtra("ip");
        if (ip == null || !IpUtils.isIpv4(ip)) {
            finish();
            return;
        }
        d = ScanSession.get(this).find(ip);
        if (d == null) {
            for (Device f : Store.get(this).favorites()) if (f.ip.equals(ip)) d = f;
        }
        if (d == null) {
            d = new Device(ip);
            Store.get(this).apply(d);
            refreshNow(); // not scanned yet (e.g. the gateway chip): probe it right away
        }
        FrameLayout content = Ui.setupScreen(this, ip, true);
        ScrollView sv = new ScrollView(this);
        body = Ui.column(this);
        int p = Ui.dp(this, 12);
        body.setPadding(p, p, p, Ui.dp(this, 24));
        sv.addView(body);
        content.addView(sv);
        render();
    }

    @Override protected void onResume() {
        super.onResume();
        if (d != null) ScanSession.get(this).addObserver(this);
    }

    @Override protected void onPause() {
        super.onPause();
        ScanSession.get(this).removeObserver(this);
    }

    @Override public void onScanChanged() {
        Device fresh = ScanSession.get(this).find(d.ip);
        if (fresh != null && fresh != d) d = fresh;
        render();
    }

    private void render() {
        if (body == null) return;
        body.removeAllViews();
        String name;
        synchronized (d) {
            name = d.displayName();
            if (getActionBar() != null) {
                getActionBar().setTitle(name.isEmpty() ? d.ip : name);
                getActionBar().setSubtitle(name.isEmpty() ? d.type : d.ip);
            }
            header(name);
            actions();
            details();
            services();
            notes();
        }
        invalidateOptionsMenu();
    }

    private void header(String name) {
        LinearLayout card = Ui.card(this);
        LinearLayout row = Ui.row(this);
        row.addView(Ui.avatar(this, DeviceType.glyph(d.type), d.alive ? DeviceType.color(d.type) : 0xFF5F6368, 56));
        LinearLayout col = Ui.column(this);
        col.setPadding(Ui.dp(this, 14), 0, 0, 0);
        String vendor = Exporter.vendorOf(d);
        TextView t = Ui.text(this, !name.isEmpty() ? name : (vendor != null ? vendor : d.ip), 20, Ui.textPrimary(this), true);
        col.addView(t);
        col.addView(Ui.mono(this, d.ip + (d.mac != null ? "  ·  " + d.mac : ""), 13, Ui.textSecondary(this)));
        String st = d.alive ? "● Online" + (d.rttMs >= 0 ? "  " + d.rttMs + " ms" : "") : "● Offline / not scanned";
        TextView s = Ui.text(this, st + (busy ? "   · checking…" : ""), 13, d.alive ? Ui.ONLINE : Ui.OFFLINE, true);
        col.addView(s);
        row.addView(col, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        card.addView(row);
        body.addView(card, Ui.matchWrap());
    }

    private void actions() {
        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        LinearLayout r = Ui.row(this);
        r.setPadding(0, Ui.dp(this, 10), 0, 0);
        final Launcher.Action primary = Launcher.primary(d);
        if (primary != null) addAction(r, "Open", true, new Runnable() {
            @Override public void run() {
                Launcher.open(DeviceActivity.this, primary);
            }
        });
        addAction(r, "Ping", primary == null, new Runnable() {
            @Override public void run() {
                ToolsActivity.open(DeviceActivity.this, ToolsActivity.PING, d.ip);
            }
        });
        addAction(r, busy ? "Refreshing…" : "Refresh", false, new Runnable() {
            @Override public void run() {
                refreshNow();
            }
        });
        addAction(r, "All ports", false, new Runnable() {
            @Override public void run() {
                ToolsActivity.open(DeviceActivity.this, ToolsActivity.PORTS, d.ip);
            }
        });
        addAction(r, "Traceroute", false, new Runnable() {
            @Override public void run() {
                ToolsActivity.open(DeviceActivity.this, ToolsActivity.TRACE, d.ip);
            }
        });
        if (d.mac != null) addAction(r, "Wake", false, new Runnable() {
            @Override public void run() {
                wake(DeviceActivity.this, d, null);
            }
        });
        addAction(r, "Open with…", false, new Runnable() {
            @Override public void run() {
                openWith();
            }
        });
        hs.addView(r);
        body.addView(hs, Ui.matchWrap());
    }

    private void addAction(LinearLayout r, String label, boolean primary, final Runnable run) {
        Button b = Ui.button(this, label, primary);
        b.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                run.run();
            }
        });
        r.addView(b, Ui.margins(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, Ui.dp(this, 42)), this, 0, 0, 8, 0));
    }

    private void details() {
        body.addView(Ui.sectionTitle(this, "Details"));
        LinearLayout card = Ui.card(this);
        card.setPadding(Ui.dp(this, 14), Ui.dp(this, 4), Ui.dp(this, 14), Ui.dp(this, 4));
        kv(card, "IP address", d.ip);
        kv(card, "MAC address", d.mac != null ? d.mac + (IpUtils.isRandomizedMac(d.mac) ? "  (private / randomized)" : "") : "Not available");
        kv(card, "Manufacturer", d.vendor);
        if (d.manufacturer != null && !d.manufacturer.equals(d.vendor)) kv(card, "Brand (UPnP/mDNS)", d.manufacturer);
        kv(card, "Model", d.model);
        kv(card, "Device type", d.type);
        kv(card, "Operating system", d.os);
        kv(card, "Friendly name", d.friendlyName);
        kv(card, "DNS hostname", d.hostname);
        kv(card, "NetBIOS name", d.netbiosName);
        kv(card, "Workgroup / domain", d.workgroup);
        kv(card, "Logged-on user", d.netbiosUser);
        kv(card, "mDNS name", d.mdnsName);
        kv(card, "Web page title", d.httpTitle);
        kv(card, "Web server", d.httpServer);
        kv(card, "SSH server", d.sshBanner);
        if (d.isGateway) kv(card, "Role", "Default gateway");
        if (d.isSelf) kv(card, "Role", "This phone");
        if (!d.sources.isEmpty()) kv(card, "Found via", TextUtils.join(", ", d.sources));
        if (d.lastSeen > 0) kv(card, "Last seen", DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(new Date(d.lastSeen)));
        body.addView(card, Ui.matchWrap());
    }

    private void kv(LinearLayout card, final String k, final String v) {
        if (v == null || v.isEmpty()) return;
        if (card.getChildCount() > 0) card.addView(Ui.dividerLine(this));
        LinearLayout row = Ui.row(this);
        row.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 10));
        TextView kt = Ui.text(this, k, 14, Ui.textSecondary(this), false);
        row.addView(kt, new LinearLayout.LayoutParams(Ui.dp(this, 130), ViewGroup.LayoutParams.WRAP_CONTENT));
        TextView vt = Ui.text(this, v, 14, Ui.textPrimary(this), false);
        vt.setTextIsSelectable(false);
        row.addView(vt, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View view) {
                Ui.copy(DeviceActivity.this, k, v);
                return true;
            }
        });
        row.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) {
                Ui.copy(DeviceActivity.this, k, v);
            }
        });
        card.addView(row, Ui.matchWrap());
    }

    private void services() {
        body.addView(Ui.sectionTitle(this, "Services" + (d.openPorts.isEmpty() ? "" : " (" + d.openPorts.size() + " open)")));
        LinearLayout card = Ui.card(this);
        card.setPadding(Ui.dp(this, 14), Ui.dp(this, 4), Ui.dp(this, 14), Ui.dp(this, 4));
        if (d.openPorts.isEmpty()) {
            TextView t = Ui.text(this, d.alive ? "No open TCP ports found in the service list. Use \"All ports\" for a full 1-65535 scan."
                    : "Run a scan or tap Refresh to check this device.", 14, Ui.textSecondary(this), false);
            t.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 10));
            card.addView(t);
        }
        for (final int p : d.openPorts) {
            if (card.getChildCount() > 0) card.addView(Ui.dividerLine(this));
            final Launcher.Action a = Launcher.forPort(d.ip, p);
            LinearLayout row = Ui.row(this);
            row.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 10));
            TextView port = Ui.mono(this, String.valueOf(p), 15, Ui.textPrimary(this));
            port.setTypeface(android.graphics.Typeface.MONOSPACE, android.graphics.Typeface.BOLD);
            row.addView(port, new LinearLayout.LayoutParams(Ui.dp(this, 64), ViewGroup.LayoutParams.WRAP_CONTENT));
            LinearLayout col = Ui.column(this);
            col.addView(Ui.text(this, Ports.name(p), 15, Ui.textPrimary(this), false));
            String banner = d.banners.get(p);
            if (banner != null) {
                TextView b = Ui.text(this, banner, 12, Ui.textSecondary(this), false);
                b.setMaxLines(2);
                b.setEllipsize(TextUtils.TruncateAt.END);
                col.addView(b);
            }
            row.addView(col, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            if (a != null) {
                TextView go = Ui.text(this, "OPEN ›", 13, Ui.isLight(this) ? Ui.BRAND : 0xFF6FB3F2, true);
                row.addView(go);
                row.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View v) {
                        Launcher.open(DeviceActivity.this, a);
                    }
                });
            }
            row.setOnLongClickListener(new View.OnLongClickListener() {
                @Override public boolean onLongClick(View v) {
                    Ui.copy(DeviceActivity.this, "address", a != null ? a.uri : d.ip + ":" + p);
                    return true;
                }
            });
            card.addView(row, Ui.matchWrap());
        }
        body.addView(card, Ui.matchWrap());

        if (!d.services.isEmpty()) {
            body.addView(Ui.sectionTitle(this, "Announced services (mDNS / UPnP)"));
            LinearLayout c2 = Ui.card(this);
            TextView t = Ui.text(this, TextUtils.join("\n", d.services), 14, Ui.textPrimary(this), false);
            t.setLineSpacing(0, 1.3f);
            c2.addView(t);
            body.addView(c2, Ui.matchWrap());
        }
        if (d.banners.containsKey(1900)) {
            body.addView(Ui.sectionTitle(this, "UPnP server"));
            LinearLayout c3 = Ui.card(this);
            c3.addView(Ui.text(this, d.banners.get(1900), 14, Ui.textPrimary(this), false));
            body.addView(c3, Ui.matchWrap());
        }
    }

    private void notes() {
        body.addView(Ui.sectionTitle(this, "Notes"));
        LinearLayout card = Ui.card(this);
        TextView t = Ui.text(this, d.notes == null ? "Tap to add a note (location, owner, credentials hint…)" : d.notes, 14,
                d.notes == null ? Ui.textSecondary(this) : Ui.textPrimary(this), false);
        card.addView(t);
        card.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Ui.prompt(DeviceActivity.this, "Notes", "Notes", d.notes, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
                        | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES, new Ui.TextCallback() {
                    @Override public void onText(String s) {
                        synchronized (d) {
                            d.notes = s.isEmpty() ? null : s;
                        }
                        Store.get(DeviceActivity.this).save(d);
                        ScanSession.get(DeviceActivity.this).userDataChanged();
                        render();
                    }
                });
            }
        });
        body.addView(card, Ui.matchWrap());
    }

    /** Re-probe this one device: ping, service ports, banners, names. */
    private void refreshNow() {
        if (busy) return;
        busy = true;
        render();
        final Device dev = d;
        final Prefs prefs = Prefs.get(this);
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    InetAddress addr = InetAddress.getByName(dev.ip);
                    int rtt = Pinger.isReachable(addr, 1500);
                    int[] ports;
                    try {
                        ports = Ports.parse(prefs.servicePorts());
                    } catch (IllegalArgumentException e) {
                        ports = Ports.parse(Ports.DEFAULT_SERVICE_PORTS);
                    }
                    TcpProbe.Result r = TcpProbe.probe(addr, ports, 0, ports.length, 1500, null);
                    synchronized (dev) {
                        if (rtt >= 0 || r.responded) {
                            dev.markAlive(rtt >= 0 ? "ICMP" : "TCP");
                            dev.rttMs = rtt >= 0 ? rtt : r.firstResponseMs;
                        } else {
                            dev.alive = false;
                        }
                        dev.openPorts.clear();
                        dev.openPorts.addAll(r.open);
                    }
                    if (r.open.contains(22)) {
                        String b = TcpProbe.grabBanner(dev.ip, 22, 1500);
                        if (b != null) synchronized (dev) { dev.sshBanner = b; dev.banners.put(22, b); }
                    }
                    for (int p : r.open) {
                        if (Ports.isHttp(p)) {
                            HttpProbe.Response h = HttpProbe.fetchRoot(dev.ip, p, 2000);
                            if (h != null) synchronized (dev) {
                                if (h.title != null) dev.httpTitle = h.title;
                                if (h.server != null) dev.httpServer = h.server;
                                dev.banners.put(p, "HTTP " + h.status + (h.server != null ? " · " + h.server : "") + (h.title != null ? " · " + h.title : ""));
                            }
                            break;
                        }
                    }
                    if (dev.hostname == null) {
                        String n = addr.getCanonicalHostName();
                        if (n != null && !n.equals(dev.ip)) synchronized (dev) { dev.hostname = n; }
                    }
                    Classifier.classify(dev);
                } catch (Exception ignored) {
                }
                busy = false;
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (!isFinishing()) render();
                    }
                });
            }
        }).start();
    }

    private void openWith() {
        final List<String> uris = new ArrayList<>();
        for (Launcher.Action a : Launcher.forDevice(d)) uris.add(a.uri);
        String[] extra = {"http://" + d.ip + "/", "https://" + d.ip + "/", "ssh://" + d.ip, "telnet://" + d.ip,
                "smb://" + d.ip + "/", "ftp://" + d.ip + "/", "vnc://" + d.ip, "rdp://full%20address=s:" + d.ip + ":3389", "rtsp://" + d.ip + ":554/"};
        for (String e : extra) if (!uris.contains(e)) uris.add(e);
        uris.add("Custom…");
        new AlertDialog.Builder(this).setTitle("Open with any app").setItems(uris.toArray(new String[0]), new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface dlg, int w) {
                String u = uris.get(w);
                if (u.equals("Custom…")) {
                    Ui.prompt(DeviceActivity.this, "Custom address", "scheme://" + d.ip + ":port", "http://" + d.ip + ":", InputType.TYPE_TEXT_VARIATION_URI
                            | InputType.TYPE_CLASS_TEXT, new Ui.TextCallback() {
                        @Override public void onText(String s) {
                            if (s.contains("://")) Launcher.open(DeviceActivity.this, s, null, true);
                        }
                    });
                } else {
                    Launcher.open(DeviceActivity.this, u, null, true);
                }
            }
        }).show();
    }

    // ------------------------------------------------------------------ shared helpers

    public static void rename(final Activity a, final Device d, final Runnable done) {
        Ui.prompt(a, "Rename device", d.displayName().isEmpty() ? d.ip : d.displayName(), d.customName,
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS, new Ui.TextCallback() {
                    @Override public void onText(String s) {
                        synchronized (d) {
                            d.customName = s.isEmpty() ? null : s;
                        }
                        Store.get(a).save(d);
                        ScanSession.get(a).userDataChanged();
                        if (done != null) done.run();
                    }
                });
    }

    public static void wake(final Activity a, final Device d, NetInfo.Iface iface) {
        String bcast = "255.255.255.255";
        if (iface == null) {
            for (NetInfo.Iface f : NetInfo.interfaces(a)) {
                long mask = IpUtils.maskOf(f.prefix);
                if ((IpUtils.toLong(f.ip) & mask) == (d.ipLong & mask)) iface = f;
            }
        }
        if (iface != null) bcast = iface.broadcast();
        final String target = bcast;
        final String mac = d.mac;
        if (mac == null) {
            ToolsActivity.open(a, ToolsActivity.WOL, null);
            return;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                String msg;
                try {
                    WakeOnLan.send(mac, target, 9);
                    msg = "Magic packet sent to " + mac + " via " + target;
                } catch (Exception e) {
                    msg = "Wake-on-LAN failed: " + e.getMessage();
                }
                final String m = msg;
                a.runOnUiThread(new Runnable() {
                    @Override public void run() {
                        Ui.toast(a, m);
                    }
                });
            }
        }).start();
    }

    // ------------------------------------------------------------------ menu

    @Override public boolean onCreateOptionsMenu(Menu menu) {
        if (d == null) return false;
        MenuItem fav = menu.add(0, 1, 0, d.favorite ? "Unfavorite" : "Favorite");
        fav.setIcon(d.favorite ? android.R.drawable.btn_star_big_on : android.R.drawable.btn_star_big_off);
        fav.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS);
        menu.add(0, 2, 0, "Rename…");
        menu.add(0, 3, 0, "Share details");
        menu.add(0, 4, 0, "Copy details");
        menu.add(0, 5, 0, "Copy IP address");
        if (d.mac != null) menu.add(0, 6, 0, "Copy MAC address");
        return true;
    }

    @Override public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case android.R.id.home: finish(); return true;
            case 1:
                synchronized (d) {
                    d.favorite = !d.favorite;
                }
                Store.get(this).save(d);
                ScanSession.get(this).userDataChanged();
                Ui.toast(this, d.favorite ? "Added to favorites" : "Removed from favorites");
                render();
                return true;
            case 2: rename(this, d, new Runnable() {
                @Override public void run() {
                    render();
                }
            }); return true;
            case 3: Launcher.share(this, d.ip, Exporter.describe(d)); return true;
            case 4: Ui.copy(this, "device", Exporter.describe(d)); return true;
            case 5: Ui.copy(this, "IP", d.ip); return true;
            case 6: Ui.copy(this, "MAC", d.mac); return true;
            default: return super.onOptionsItemSelected(item);
        }
    }
}
