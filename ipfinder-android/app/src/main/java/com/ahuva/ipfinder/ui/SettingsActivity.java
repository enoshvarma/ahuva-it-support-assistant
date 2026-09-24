package com.ahuva.ipfinder.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CompoundButton;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import com.ahuva.ipfinder.BuildConfig;
import com.ahuva.ipfinder.core.Ports;

public class SettingsActivity extends Activity {
    private LinearLayout body;
    private Prefs prefs;

    @Override protected void onCreate(Bundle state) {
        Ui.applyTheme(this);
        super.onCreate(state);
        prefs = Prefs.get(this);
        FrameLayout content = Ui.setupScreen(this, "Settings", true);
        ScrollView sv = new ScrollView(this);
        body = Ui.column(this);
        body.setPadding(Ui.dp(this, 12), Ui.dp(this, 4), Ui.dp(this, 12), Ui.dp(this, 24));
        sv.addView(body);
        content.addView(sv);
        render();
    }

    private void render() {
        body.removeAllViews();
        body.addView(Ui.sectionTitle(this, "Discovery"));
        LinearLayout c1 = Ui.card(this);
        toggle(c1, "netbios", "NetBIOS names", "Windows/Samba computer name, workgroup and MAC", prefs.netbios());
        toggle(c1, "mdns", "mDNS / Bonjour", "Names and services of Apple, Android, Chromecast, printers, smart home", prefs.mdns());
        toggle(c1, "ssdp", "UPnP / SSDP", "Friendly name and model of routers, TVs, media servers", prefs.ssdp());
        toggle(c1, "rdns", "Reverse DNS", "Host names from your router's DNS", prefs.reverseDns());
        toggle(c1, "services", "Scan service ports", "Check the service port list on every live device", prefs.scanServices());
        toggle(c1, "http", "Web page titles & banners", "Read HTTP titles, SSH/FTP banners and TLS certificate names", prefs.httpInfo());
        toggle(c1, "dead", "Show offline addresses", "List every address in the range, like a full IP sheet", prefs.includeDead());
        body.addView(c1, Ui.matchWrap());

        body.addView(Ui.sectionTitle(this, "Performance"));
        LinearLayout c2 = Ui.card(this);
        number(c2, "threads", "Parallel probes", "More is faster; lower it on weak Wi-Fi (4-256)", prefs.threads());
        number(c2, "ping_timeout", "Ping timeout (ms)", "Wait per ICMP echo", prefs.pingTimeout());
        number(c2, "tcp_timeout", "TCP timeout (ms)", "Wait per TCP connect; raise for slow VPN links", prefs.tcpTimeout());
        text(c2, "service_ports", "Service ports", prefs.servicePorts());
        body.addView(c2, Ui.matchWrap());

        body.addView(Ui.sectionTitle(this, "Appearance"));
        LinearLayout c3 = Ui.card(this);
        row(c3, "Theme", themeLabel(prefs.theme()), new Runnable() {
            @Override public void run() {
                chooseTheme();
            }
        });
        toggle(c3, "screen_on", "Keep screen on while scanning", null, prefs.keepScreenOn());
        body.addView(c3, Ui.matchWrap());

        body.addView(Ui.sectionTitle(this, "Data"));
        LinearLayout c4 = Ui.card(this);
        row(c4, "Forget scan history", "Clears the saved last scan and the known-device list used for NEW badges", new Runnable() {
            @Override public void run() {
                confirm("Forget scan history?", new Runnable() {
                    @Override public void run() {
                        ScanSession.get(SettingsActivity.this).clear();
                        Ui.toast(SettingsActivity.this, "History cleared");
                    }
                });
            }
        });
        row(c4, "Delete favorites, names and notes", "Cannot be undone", new Runnable() {
            @Override public void run() {
                confirm("Delete all favorites, custom names and notes?", new Runnable() {
                    @Override public void run() {
                        Store.get(SettingsActivity.this).clearAll();
                        ScanSession.get(SettingsActivity.this).clear();
                        Ui.toast(SettingsActivity.this, "Deleted");
                    }
                });
            }
        });
        row(c4, "Reset settings to defaults", null, new Runnable() {
            @Override public void run() {
                prefs.reset();
                render();
            }
        });
        body.addView(c4, Ui.matchWrap());

        TextView v = Ui.text(this, "Ahuva IP Finder " + BuildConfig.VERSION_NAME + " · everything runs locally on your phone",
                12, Ui.textSecondary(this), false);
        v.setPadding(Ui.dp(this, 4), Ui.dp(this, 16), 0, 0);
        body.addView(v);
    }

    private void confirm(String msg, final Runnable r) {
        new AlertDialog.Builder(this).setMessage(msg).setPositiveButton("OK", new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface d, int w) {
                r.run();
            }
        }).setNegativeButton("Cancel", null).show();
    }

    private static String themeLabel(String t) {
        return "light".equals(t) ? "Light" : "dark".equals(t) ? "Dark" : "Follow system";
    }

    private void chooseTheme() {
        final String[] keys = {"system", "dark", "light"};
        String[] labels = {"Follow system", "Dark", "Light"};
        int sel = 0;
        for (int i = 0; i < keys.length; i++) if (keys[i].equals(prefs.theme())) sel = i;
        new AlertDialog.Builder(this).setTitle("Theme").setSingleChoiceItems(labels, sel, new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface d, int w) {
                prefs.setString("theme", keys[w]);
                d.dismiss();
                recreate();
            }
        }).show();
    }

    private void addDivider(LinearLayout card) {
        if (card.getChildCount() > 0) card.addView(Ui.dividerLine(this));
    }

    private LinearLayout labels(String title, String sub) {
        LinearLayout col = Ui.column(this);
        col.addView(Ui.text(this, title, 15, Ui.textPrimary(this), false));
        if (sub != null) col.addView(Ui.text(this, sub, 12, Ui.textSecondary(this), false));
        return col;
    }

    private void toggle(LinearLayout card, final String key, String title, String sub, boolean value) {
        addDivider(card);
        LinearLayout r = Ui.row(this);
        r.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 10));
        r.addView(labels(title, sub), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        final Switch sw = new Switch(this);
        sw.setChecked(value);
        sw.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override public void onCheckedChanged(CompoundButton b, boolean checked) {
                prefs.setBool(key, checked);
            }
        });
        r.addView(sw);
        r.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                sw.toggle();
            }
        });
        card.addView(r, Ui.matchWrap());
    }

    private void row(LinearLayout card, String title, String sub, final Runnable onClick) {
        addDivider(card);
        LinearLayout r = Ui.row(this);
        r.setPadding(0, Ui.dp(this, 12), 0, Ui.dp(this, 12));
        r.addView(labels(title, sub), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        r.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                onClick.run();
            }
        });
        card.addView(r, Ui.matchWrap());
    }

    private void number(LinearLayout card, final String key, final String title, String sub, int value) {
        row(card, title + ":  " + value, sub, new Runnable() {
            @Override public void run() {
                Ui.prompt(SettingsActivity.this, title, title, String.valueOf(value), InputType.TYPE_CLASS_NUMBER, new Ui.TextCallback() {
                    @Override public void onText(String s) {
                        try {
                            prefs.setInt(key, Integer.parseInt(s));
                        } catch (NumberFormatException e) {
                            Ui.toast(SettingsActivity.this, "Enter a number");
                        }
                        render();
                    }
                });
            }
        });
    }

    private void text(LinearLayout card, final String key, final String title, final String value) {
        String preview = value.length() > 60 ? value.substring(0, 60) + "…" : value;
        row(card, title, preview + "  (" + Ports.parse(value).length + " ports)", new Runnable() {
            @Override public void run() {
                Ui.prompt(SettingsActivity.this, title, "22,80,443,8000-8100", value,
                        InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, new Ui.TextCallback() {
                            @Override public void onText(String s) {
                                try {
                                    int n = Ports.parse(s).length;
                                    if (n == 0) throw new IllegalArgumentException("Enter at least one port");
                                    prefs.setString(key, s.replaceAll("\\s+", ""));
                                } catch (IllegalArgumentException e) {
                                    Ui.toast(SettingsActivity.this, e.getMessage());
                                }
                                render();
                            }
                        });
            }
        });
    }
}
