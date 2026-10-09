package com.ahuva.ipfinder.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.AdapterView;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.SearchView;
import android.widget.TextView;

import com.ahuva.ipfinder.BuildConfig;
import com.ahuva.ipfinder.core.Device;
import com.ahuva.ipfinder.core.Exporter;
import com.ahuva.ipfinder.core.IpUtils;

import java.io.OutputStream;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity implements ScanSession.Observer {
    private static final int REQ_SAVE = 10;
    private static final String F_ALL = "all", F_ONLINE = "online", F_FAV = "fav", F_NEW = "new";

    private ScanSession session;
    private EditText rangeInput;
    private Button scanButton;
    private ProgressBar progress;
    private TextView status;
    private LinearLayout ifaceChips;
    private LinearLayout filterChips;
    private ListView list;
    private TextView empty;
    private DeviceAdapter adapter;
    private List<NetInfo.Iface> ifaces = new ArrayList<>();
    private NetInfo.Iface selectedIface;
    private String filter = F_ALL;
    private String query = "";
    private String pendingExport;
    private boolean themeLight;
    private boolean autoScan;

    @Override protected void onCreate(Bundle state) {
        Ui.applyTheme(this);
        super.onCreate(state);
        themeLight = Ui.isLight(this);
        session = ScanSession.get(this);
        FrameLayout content = Ui.setupScreen(this, getString(com.ahuva.ipfinder.R.string.app_name), false);
        if (state != null) {
            filter = state.getString("filter", F_ALL);
            query = state.getString("query", "");
        }
        build(content);
        autoScan = state == null && getIntent().getBooleanExtra("autoscan", false);
    }

    /** Launch extra used by shortcuts and the CI emulator smoke test: start scanning right away. */
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra("autoscan", false)) autoScan = true;
    }

    private void build(FrameLayout content) {
        LinearLayout col = Ui.column(this);
        content.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout top = Ui.column(this);
        top.setBackgroundColor(Ui.surface(this));
        top.setPadding(Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 8));
        col.addView(top, Ui.matchWrap());

        LinearLayout r1 = Ui.row(this);
        rangeInput = Ui.input(this, "192.168.1.1-254 or 10.0.0.0/24", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        rangeInput.setTypeface(android.graphics.Typeface.MONOSPACE);
        rangeInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        rangeInput.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                    toggleScan();
                    return true;
                }
                return false;
            }
        });
        r1.addView(rangeInput, new LinearLayout.LayoutParams(0, Ui.dp(this, 46), 1f));
        scanButton = Ui.button(this, "Scan", true);
        scanButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                toggleScan();
            }
        });
        LinearLayout.LayoutParams sb = new LinearLayout.LayoutParams(Ui.dp(this, 96), Ui.dp(this, 46));
        sb.leftMargin = Ui.dp(this, 8);
        r1.addView(scanButton, sb);
        top.addView(r1, Ui.matchWrap());

        HorizontalScrollView hs = new HorizontalScrollView(this);
        hs.setHorizontalScrollBarEnabled(false);
        ifaceChips = Ui.row(this);
        hs.addView(ifaceChips);
        top.addView(hs, Ui.margins(Ui.matchWrap(), this, 0, 8, 0, 0));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(1000);
        top.addView(progress, Ui.margins(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 6)), this, 0, 10, 0, 0));
        status = Ui.text(this, "", 13, Ui.textSecondary(this), false);
        top.addView(status, Ui.margins(Ui.matchWrap(), this, 0, 4, 0, 0));

        HorizontalScrollView fs = new HorizontalScrollView(this);
        fs.setHorizontalScrollBarEnabled(false);
        filterChips = Ui.row(this);
        fs.addView(filterChips);
        top.addView(fs, Ui.margins(Ui.matchWrap(), this, 0, 8, 0, 0));

        col.addView(Ui.dividerLine(this));

        FrameLayout listWrap = new FrameLayout(this);
        list = new ListView(this);
        list.setDivider(new android.graphics.drawable.ColorDrawable(Ui.divider(this)));
        list.setDividerHeight(Math.max(1, Ui.dp(this, 0.7f)));
        list.setClipToPadding(false);
        list.setPadding(0, 0, 0, Ui.dp(this, 16));
        list.setFastScrollEnabled(true);
        adapter = new DeviceAdapter(this);
        list.setAdapter(adapter);
        list.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override public void onItemClick(AdapterView<?> parent, View view, int pos, long id) {
                DeviceActivity.open(MainActivity.this, adapter.getItem(pos).ip);
            }
        });
        list.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
            @Override public boolean onItemLongClick(AdapterView<?> parent, View view, int pos, long id) {
                quickActions(view, adapter.getItem(pos));
                return true;
            }
        });
        listWrap.addView(list);
        empty = Ui.text(this, "", 15, Ui.textSecondary(this), false);
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(Ui.dp(this, 32), Ui.dp(this, 32), Ui.dp(this, 32), Ui.dp(this, 32));
        listWrap.addView(empty, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        list.setEmptyView(empty);
        col.addView(listWrap, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putString("filter", filter);
        out.putString("query", query);
    }

    @Override protected void onResume() {
        super.onResume();
        if (Ui.isLight(this) != themeLight || themeChanged()) {
            recreate();
            return;
        }
        session.addObserver(this);
        refreshInterfaces();
        onScanChanged();
        if (autoScan) {
            autoScan = false;
            String range = getIntent().getStringExtra("range");
            if (range != null) rangeInput.setText(range);
            if (!session.running) toggleScan();
        }
    }

    private boolean themeChanged() {
        String t = Prefs.get(this).theme();
        return ("light".equals(t) && !themeLight) || ("dark".equals(t) && themeLight);
    }

    @Override protected void onPause() {
        super.onPause();
        session.removeObserver(this);
    }

    private void refreshInterfaces() {
        ifaces = NetInfo.interfaces(this);
        String prevName = selectedIface == null ? null : selectedIface.name;
        selectedIface = null;
        for (NetInfo.Iface f : ifaces) if (f.name.equals(prevName)) selectedIface = f;
        if (selectedIface == null && !ifaces.isEmpty() && !"Mobile data".equals(ifaces.get(0).kind)) selectedIface = ifaces.get(0);

        if (rangeInput.getText().length() == 0) {
            String last = Prefs.get(this).lastRange();
            if (selectedIface != null) rangeInput.setText(selectedIface.range());
            else if (last != null) rangeInput.setText(last);
        }
        ifaceChips.removeAllViews();
        for (final NetInfo.Iface f : ifaces) {
            final String range = f.range();
            TextView chip = Ui.chip(this, f.kind + "  " + range, range.equals(rangeInput.getText().toString().trim()));
            chip.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    selectedIface = f;
                    rangeInput.setText(range);
                    refreshInterfaces();
                }
            });
            ifaceChips.addView(chip, Ui.margins(Ui.wrap(), this, 0, 0, 8, 0));
        }
        if (selectedIface != null && selectedIface.gateway != null && !selectedIface.gateway.equals(selectedIface.ip)) {
            final String gw = selectedIface.gateway;
            TextView chip = Ui.chip(this, "Gateway " + gw, false);
            chip.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    DeviceActivity.open(MainActivity.this, gw);
                }
            });
            ifaceChips.addView(chip, Ui.margins(Ui.wrap(), this, 0, 0, 8, 0));
        }
        if (ifaces.isEmpty()) {
            TextView chip = Ui.chip(this, "No network - connect to Wi-Fi or Ethernet", false);
            ifaceChips.addView(chip);
        }
        updateSubtitle();
    }

    private void updateSubtitle() {
        if (getActionBar() == null) return;
        String sub;
        if (selectedIface == null) {
            sub = ifaces.isEmpty() ? "Not connected" : "Choose a network";
        } else {
            NetInfo.Wifi w = "Wi-Fi".equals(selectedIface.kind) ? NetInfo.wifi(this) : null;
            sub = selectedIface.kind + (w != null && w.ssid != null ? " \"" + w.ssid + "\"" : "") + " · " + selectedIface.ip;
        }
        getActionBar().setSubtitle(sub);
    }

    /** Uses the interface that owns the typed range (for self / gateway / DNS), or none for remote ranges. */
    private NetInfo.Iface ifaceFor(long first) {
        for (NetInfo.Iface f : ifaces) {
            long mask = IpUtils.maskOf(Math.max(f.prefix, 8));
            if ((IpUtils.toLong(f.ip) & mask) == (first & mask)) return f;
        }
        return null;
    }

    private void toggleScan() {
        if (session.running) {
            session.stop();
            return;
        }
        hideKeyboard();
        final String spec = rangeInput.getText().toString().trim();
        if (spec.isEmpty()) {
            Ui.toast(this, "Enter an IP range to scan");
            return;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                // Parsing can resolve hostnames, so keep it off the UI thread.
                List<Long> targets = null;
                String error = null;
                try {
                    targets = IpUtils.parseTargets(spec);
                } catch (IllegalArgumentException e) {
                    error = e.getMessage();
                }
                final List<Long> t = targets;
                final String err = error;
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (isFinishing()) return;
                        if (t == null) {
                            new AlertDialog.Builder(MainActivity.this).setTitle("Can't scan that range")
                                    .setMessage(err + "\n\nExamples:\n192.168.1.1-254\n192.168.1.0/24\n10.0.0.1-10.0.1.255\n192.168.1.10, 192.168.1.20\n192.168.1.*")
                                    .setPositiveButton("OK", null).show();
                            return;
                        }
                        if (filter.equals(F_FAV) || filter.equals(F_NEW)) filter = F_ALL;
                        session.start(spec, t, ifaceFor(t.get(0)));
                        onScanChanged();
                    }
                });
            }
        }).start();
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(rangeInput.getWindowToken(), 0);
        rangeInput.clearFocus();
    }

    @Override public void onScanChanged() {
        boolean running = session.running;
        scanButton.setText(running ? "Stop" : "Scan");
        Ui.ripple(scanButton, running ? Ui.DANGER : Ui.BRAND, Ui.dp(this, 12));
        if (running && Prefs.get(this).keepScreenOn()) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        List<Device> all = session.snapshot();
        int online = 0, fresh = 0, favs = 0;
        for (Device d : all) {
            if (d.alive) online++;
            if (d.isNew) fresh++;
            if (d.favorite) favs++;
        }
        if (running) {
            progress.setVisibility(View.VISIBLE);
            progress.setIndeterminate(session.total == 0);
            progress.setProgress(session.total == 0 ? 0 : (int) (1000L * session.done / session.total));
            long secs = (System.currentTimeMillis() - session.startedAt) / 1000;
            status.setText(session.stage + " · " + online + " found · " + secs + "s");
        } else {
            progress.setVisibility(View.INVISIBLE);
            if (session.finishedAt > 0 && session.range != null) {
                String when = DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(session.finishedAt));
                String what = session.fromHistory ? "Last scan " + session.range + " at " + when
                        : ("Stopped".equals(session.stage) ? "Stopped · " : "") + online + " devices online · " + session.range + " · "
                        + String.format(Locale.US, "%.1fs", session.elapsedMs / 1000.0);
                status.setText(what);
            } else {
                status.setText("Ready. Tap Scan to find every device on the network.");
            }
        }
        buildFilterChips(all.size(), online, favs, fresh);
        adapter.setItems(filtered(all));
        if (running) empty.setText("Scanning…");
        else if (!query.isEmpty()) empty.setText("No devices match \"" + query + "\"");
        else if (filter.equals(F_FAV)) empty.setText("No favorites yet.\nOpen a device and tap the star to add it.");
        else if (filter.equals(F_NEW)) empty.setText("No new devices since the previous scan.");
        else empty.setText("Tap Scan to discover every device on your network: names, MAC addresses, manufacturers and open services.");
    }

    private void buildFilterChips(int all, int online, int favs, int fresh) {
        filterChips.removeAllViews();
        addFilterChip(F_ALL, "All " + all);
        addFilterChip(F_ONLINE, "Online " + online);
        addFilterChip(F_FAV, "★ Favorites");
        if (fresh > 0 || filter.equals(F_NEW)) addFilterChip(F_NEW, "New " + fresh);
        if (!query.isEmpty()) {
            TextView q = Ui.chip(this, "✕  \"" + query + "\"", true);
            q.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    query = "";
                    invalidateOptionsMenu();
                    onScanChanged();
                }
            });
            filterChips.addView(q, Ui.margins(Ui.wrap(), this, 0, 0, 8, 0));
        }
    }

    private void addFilterChip(final String key, String label) {
        TextView t = Ui.chip(this, label, filter.equals(key));
        t.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                filter = key;
                onScanChanged();
            }
        });
        filterChips.addView(t, Ui.margins(Ui.wrap(), this, 0, 0, 8, 0));
    }

    private List<Device> filtered(List<Device> all) {
        List<Device> out = new ArrayList<>();
        if (filter.equals(F_FAV)) {
            Set<String> seen = new HashSet<>();
            for (Device d : all) if (d.favorite) { out.add(d); seen.add(d.ip); }
            for (Device d : Store.get(this).favorites()) if (!seen.contains(d.ip) && IpUtils.isIpv4(d.ip)) out.add(d);
        } else {
            for (Device d : all) {
                if (filter.equals(F_ONLINE) && !d.alive) continue;
                if (filter.equals(F_NEW) && !d.isNew) continue;
                out.add(d);
            }
        }
        if (!query.isEmpty()) {
            String q = query.toLowerCase(Locale.getDefault());
            List<Device> m = new ArrayList<>();
            for (Device d : out) if (matches(d, q)) m.add(d);
            out = m;
        }
        sort(out);
        return out;
    }

    private static boolean matches(Device d, String q) {
        synchronized (d) {
            String hay = (d.ip + " " + d.displayName() + " " + d.mac + " " + d.vendor + " " + d.manufacturer + " " + d.type + " "
                    + d.hostname + " " + d.netbiosName + " " + d.mdnsName + " " + d.model + " " + d.serviceSummary() + " "
                    + d.openPorts + " " + d.notes + " " + d.httpTitle).toLowerCase(Locale.getDefault());
            return hay.contains(q);
        }
    }

    private void sort(List<Device> l) {
        final String mode = Prefs.get(this).sort();
        Collections.sort(l, new Comparator<Device>() {
            @Override public int compare(Device a, Device b) {
                int r = 0;
                switch (mode) {
                    case "name":
                        r = key(a.displayName(), Exporter.vendorOf(a)).compareToIgnoreCase(key(b.displayName(), Exporter.vendorOf(b)));
                        break;
                    case "vendor":
                        r = key(Exporter.vendorOf(a), null).compareToIgnoreCase(key(Exporter.vendorOf(b), null));
                        break;
                    case "type":
                        r = a.type.compareTo(b.type);
                        break;
                    case "latency":
                        r = Integer.compare(a.rttMs < 0 ? Integer.MAX_VALUE : a.rttMs, b.rttMs < 0 ? Integer.MAX_VALUE : b.rttMs);
                        break;
                    default:
                        break;
                }
                if (r == 0 && a.alive != b.alive && !"ip".equals(mode)) r = a.alive ? -1 : 1;
                return r != 0 ? r : Long.compare(a.ipLong, b.ipLong);
            }
        });
    }

    private static String key(String s, String fallback) {
        if (s != null && !s.isEmpty()) return s;
        if (fallback != null && !fallback.isEmpty()) return fallback;
        return "￿"; // unnamed last
    }

    private void quickActions(View anchor, final Device d) {
        PopupMenu pm = new PopupMenu(this, anchor, Gravity.END);
        final Launcher.Action open = Launcher.primary(d);
        Menu m = pm.getMenu();
        if (open != null) m.add(0, 1, 0, open.label);
        m.add(0, 2, 0, "Details");
        m.add(0, 3, 0, "Copy IP address");
        if (d.mac != null) m.add(0, 4, 0, "Copy MAC address");
        m.add(0, 5, 0, "Ping");
        m.add(0, 6, 0, "Scan all ports");
        if (d.mac != null) m.add(0, 7, 0, "Wake-on-LAN");
        m.add(0, 8, 0, d.favorite ? "Remove from favorites" : "Add to favorites");
        m.add(0, 9, 0, "Rename…");
        m.add(0, 10, 0, "Share");
        pm.setOnMenuItemClickListener(new PopupMenu.OnMenuItemClickListener() {
            @Override public boolean onMenuItemClick(MenuItem item) {
                switch (item.getItemId()) {
                    case 1: Launcher.open(MainActivity.this, open); break;
                    case 2: DeviceActivity.open(MainActivity.this, d.ip); break;
                    case 3: Ui.copy(MainActivity.this, "IP", d.ip); break;
                    case 4: Ui.copy(MainActivity.this, "MAC", d.mac); break;
                    case 5: ToolsActivity.open(MainActivity.this, ToolsActivity.PING, d.ip); break;
                    case 6: ToolsActivity.open(MainActivity.this, ToolsActivity.PORTS, d.ip); break;
                    case 7: DeviceActivity.wake(MainActivity.this, d, selectedIface); break;
                    case 8:
                        d.favorite = !d.favorite;
                        Store.get(MainActivity.this).save(d);
                        onScanChanged();
                        break;
                    case 9: DeviceActivity.rename(MainActivity.this, d, new Runnable() {
                        @Override public void run() {
                            onScanChanged();
                        }
                    }); break;
                    case 10: Launcher.share(MainActivity.this, d.ip, Exporter.describe(d)); break;
                    default: return false;
                }
                return true;
            }
        });
        pm.show();
    }

    // ------------------------------------------------------------------ menu

    @Override public boolean onCreateOptionsMenu(Menu menu) {
        MenuItem search = menu.add(0, 1, 0, "Search");
        search.setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS | MenuItem.SHOW_AS_ACTION_COLLAPSE_ACTION_VIEW);
        search.setIcon(android.R.drawable.ic_menu_search);
        final SearchView sv = new SearchView(getActionBar() != null ? getActionBar().getThemedContext() : this);
        sv.setQueryHint("Name, IP, MAC, vendor, port…");
        sv.setMaxWidth(Integer.MAX_VALUE);
        sv.setOnQueryTextListener(new SearchView.OnQueryTextListener() {
            @Override public boolean onQueryTextSubmit(String q) {
                sv.clearFocus();
                return true;
            }

            @Override public boolean onQueryTextChange(String q) {
                query = q.trim();
                onScanChanged();
                return true;
            }
        });
        search.setActionView(sv);
        if (!query.isEmpty()) {
            search.expandActionView();
            sv.setQuery(query, false);
        }
        MenuItem tools = menu.add(0, 2, 0, "Tools");
        tools.setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM);
        menu.add(0, 3, 0, "Sort…");
        menu.add(0, 4, 0, "Export / share results…");
        menu.add(0, 5, 0, "Network info");
        menu.add(0, 6, 0, "Clear results");
        menu.add(0, 7, 0, "Settings");
        menu.add(0, 8, 0, "About");
        return true;
    }

    @Override public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case 2: ToolsActivity.open(this, ToolsActivity.PING, null); return true;
            case 3: chooseSort(); return true;
            case 4: exportDialog(); return true;
            case 5: ToolsActivity.open(this, ToolsActivity.NETINFO, null); return true;
            case 6:
                if (session.running) Ui.toast(this, "Stop the scan first");
                else session.clear();
                return true;
            case 7: startActivity(new Intent(this, SettingsActivity.class)); return true;
            case 8: about(); return true;
            default: return super.onOptionsItemSelected(item);
        }
    }

    private void chooseSort() {
        final String[] keys = {"ip", "name", "vendor", "type", "latency"};
        String[] labels = {"IP address", "Name", "Manufacturer", "Device type", "Response time"};
        int sel = 0;
        for (int i = 0; i < keys.length; i++) if (keys[i].equals(Prefs.get(this).sort())) sel = i;
        new AlertDialog.Builder(this).setTitle("Sort by").setSingleChoiceItems(labels, sel, new DialogInterface.OnClickListener() {
            @Override public void onClick(DialogInterface dlg, int which) {
                Prefs.get(MainActivity.this).setString("sort", keys[which]);
                dlg.dismiss();
                onScanChanged();
            }
        }).show();
    }

    private void exportDialog() {
        final List<Device> rows = filtered(session.snapshot());
        if (rows.isEmpty()) {
            Ui.toast(this, "Nothing to export yet - run a scan first");
            return;
        }
        final String[] fmts = {Exporter.CSV, Exporter.HTML, Exporter.JSON, Exporter.TXT};
        String[] labels = {"CSV (Excel, Sheets)", "HTML report", "JSON", "Plain text"};
        final int[] chosen = {0};
        new AlertDialog.Builder(this).setTitle("Export " + rows.size() + " devices")
                .setSingleChoiceItems(labels, 0, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        chosen[0] = w;
                    }
                })
                .setPositiveButton("Share", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        shareExport(rows, fmts[chosen[0]]);
                    }
                })
                .setNeutralButton("Save to file", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        saveExport(rows, fmts[chosen[0]]);
                    }
                })
                .setNegativeButton("Cancel", null).show();
    }

    private void shareExport(List<Device> rows, String fmt) {
        try {
            String name = Exporter.fileName(fmt);
            Uri uri = ExportProvider.write(this, name, Exporter.export(rows, fmt, String.valueOf(session.range)));
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(Exporter.mime(fmt));
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.putExtra(Intent.EXTRA_SUBJECT, "Network scan " + session.range);
            i.setClipData(android.content.ClipData.newRawUri(name, uri));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(i, "Share scan results"));
        } catch (Exception e) {
            Ui.toast(this, "Export failed: " + e.getMessage());
        }
    }

    private void saveExport(List<Device> rows, String fmt) {
        pendingExport = Exporter.export(rows, fmt, String.valueOf(session.range));
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(Exporter.mime(fmt));
        i.putExtra(Intent.EXTRA_TITLE, Exporter.fileName(fmt));
        try {
            startActivityForResult(i, REQ_SAVE);
        } catch (Exception e) {
            Ui.toast(this, "No file picker available - use Share instead");
        }
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_SAVE || res != RESULT_OK || data == null || data.getData() == null || pendingExport == null) return;
        try {
            OutputStream out = getContentResolver().openOutputStream(data.getData());
            if (out == null) throw new java.io.IOException("cannot open file");
            try {
                out.write(pendingExport.getBytes("UTF-8"));
            } finally {
                out.close();
            }
            Ui.toast(this, "Saved");
        } catch (Exception e) {
            Ui.toast(this, "Save failed: " + e.getMessage());
        }
        pendingExport = null;
    }

    private void about() {
        String msg = getString(com.ahuva.ipfinder.R.string.app_full_name) + " " + BuildConfig.VERSION_NAME + "\n\n"
                + "Finds every device on your network and shows its name, IP, MAC, manufacturer, device type and open services, "
                + "then opens them in the right app (browser, SSH, RDP, VNC, FTP, SMB, RTSP…).\n\n"
                + "Discovery: ICMP ping, TCP probes, NetBIOS, mDNS/Bonjour, UPnP/SSDP, reverse DNS and ARP.\n\n"
                + "MAC addresses: Android 10 and later block apps from reading the ARP table. The app still gets MACs from "
                + "NetBIOS (Windows/Samba) and mDNS announcements; other devices show their IP and name only.\n\n"
                + "Privacy: everything runs on your phone. No accounts, no analytics, nothing is uploaded.\n\n"
                + "Vendor database: " + session.oui().size() + " IEEE OUI entries.";
        new AlertDialog.Builder(this).setTitle("About").setMessage(msg).setPositiveButton("OK", null).show();
    }
}
