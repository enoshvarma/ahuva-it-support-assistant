package com.ahuva.ipfinder.ui;

import android.content.Context;
import android.graphics.Typeface;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.ahuva.ipfinder.core.Device;
import com.ahuva.ipfinder.core.DeviceType;
import com.ahuva.ipfinder.core.Exporter;

import java.util.ArrayList;
import java.util.List;

/** Device list rows. */
public class DeviceAdapter extends BaseAdapter {
    private final Context c;
    private List<Device> items = new ArrayList<>();

    public DeviceAdapter(Context c) {
        this.c = c;
    }

    public void setItems(List<Device> list) {
        items = list;
        notifyDataSetChanged();
    }

    @Override public int getCount() { return items.size(); }

    @Override public Device getItem(int i) { return items.get(i); }

    @Override public long getItemId(int i) { return items.get(i).ipLong; }

    @Override public boolean hasStableIds() { return true; }

    private static final class Holder {
        TextView avatar, dot, title, line1, line2, services, rtt, badge;
    }

    @Override public View getView(int pos, View convert, ViewGroup parent) {
        Holder h;
        if (convert == null) {
            h = new Holder();
            convert = build(h);
            convert.setTag(h);
        } else {
            h = (Holder) convert.getTag();
        }
        bind(h, items.get(pos));
        return convert;
    }

    private View build(Holder h) {
        LinearLayout row = Ui.row(c);
        int p = Ui.dp(c, 12);
        row.setPadding(Ui.dp(c, 16), p, Ui.dp(c, 16), p);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setLayoutParams(new AbsListView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        FrameLayout av = new FrameLayout(c);
        h.avatar = Ui.avatar(c, "D", 0xFF607D8B, 44);
        av.addView(h.avatar, new FrameLayout.LayoutParams(Ui.dp(c, 44), Ui.dp(c, 44)));
        h.dot = new TextView(c);
        FrameLayout.LayoutParams dl = new FrameLayout.LayoutParams(Ui.dp(c, 13), Ui.dp(c, 13), Gravity.BOTTOM | Gravity.END);
        av.addView(h.dot, dl);
        row.addView(av, new LinearLayout.LayoutParams(Ui.dp(c, 46), Ui.dp(c, 46)));

        LinearLayout mid = Ui.column(c);
        mid.setPadding(Ui.dp(c, 14), 0, Ui.dp(c, 8), 0);
        h.title = Ui.text(c, "", 16, Ui.textPrimary(c), true);
        h.title.setSingleLine(true);
        h.title.setEllipsize(TextUtils.TruncateAt.END);
        h.line1 = Ui.mono(c, "", 13, Ui.textPrimary(c));
        h.line1.setSingleLine(true);
        h.line1.setEllipsize(TextUtils.TruncateAt.END);
        h.line2 = Ui.text(c, "", 13, Ui.textSecondary(c), false);
        h.line2.setSingleLine(true);
        h.line2.setEllipsize(TextUtils.TruncateAt.END);
        h.services = Ui.text(c, "", 12, Ui.isLight(c) ? 0xFF00897B : Ui.ACCENT, true);
        h.services.setSingleLine(true);
        h.services.setEllipsize(TextUtils.TruncateAt.END);
        mid.addView(h.title);
        mid.addView(h.line1);
        mid.addView(h.line2);
        mid.addView(h.services);
        row.addView(mid, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        LinearLayout right = Ui.column(c);
        right.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        h.rtt = Ui.text(c, "", 12, Ui.textSecondary(c), false);
        h.badge = Ui.text(c, "", 11, 0xFFFFFFFF, true);
        h.badge.setPadding(Ui.dp(c, 6), Ui.dp(c, 1), Ui.dp(c, 6), Ui.dp(c, 1));
        right.addView(h.rtt, Ui.wrap());
        LinearLayout.LayoutParams bl = Ui.wrap();
        bl.topMargin = Ui.dp(c, 4);
        right.addView(h.badge, bl);
        row.addView(right, Ui.wrap());
        return row;
    }

    private void bind(Holder h, Device d) {
        synchronized (d) {
            String name = d.displayName();
            String vendor = Exporter.vendorOf(d);
            h.avatar.setText(DeviceType.glyph(d.type));
            h.avatar.setTextSize(DeviceType.glyph(d.type).length() > 1 ? 13 : 17);
            h.avatar.setBackground(Ui.oval(d.alive ? DeviceType.color(d.type) : 0xFF5F6368));
            h.dot.setBackground(Ui.oval(d.alive ? Ui.ONLINE : Ui.OFFLINE));
            h.dot.setVisibility(View.VISIBLE);

            String title = !name.isEmpty() ? name : (vendor != null && !vendor.startsWith("Private") ? vendor : d.ip);
            h.title.setText(d.favorite ? "★ " + title : title);
            h.title.setTextColor(d.alive ? Ui.textPrimary(c) : Ui.textSecondary(c));

            StringBuilder l1 = new StringBuilder(d.ip);
            if (d.mac != null) l1.append("  ").append(d.mac);
            h.line1.setText(l1);

            StringBuilder l2 = new StringBuilder();
            if (vendor != null && !title.equals(vendor)) l2.append(vendor);
            if (d.alive && !DeviceType.UNKNOWN.equals(d.type)) {
                if (l2.length() > 0) l2.append(" · ");
                l2.append(d.type);
            }
            if (!d.alive) {
                if (l2.length() > 0) l2.append(" · ");
                l2.append("Offline");
            }
            h.line2.setText(l2);
            h.line2.setVisibility(l2.length() == 0 ? View.GONE : View.VISIBLE);

            String svc = d.serviceSummary();
            h.services.setText(svc);
            h.services.setVisibility(svc.isEmpty() ? View.GONE : View.VISIBLE);

            h.rtt.setText(d.alive && d.rttMs >= 0 ? d.rttMs + " ms" : "");
            if (d.isNew) {
                h.badge.setText("NEW");
                h.badge.setBackground(Ui.round(Ui.WARN, Ui.dp(c, 6)));
                h.badge.setVisibility(View.VISIBLE);
            } else if (d.isGateway || d.isSelf) {
                h.badge.setText(d.isSelf ? "YOU" : "GW");
                h.badge.setBackground(Ui.round(Ui.BRAND, Ui.dp(c, 6)));
                h.badge.setVisibility(View.VISIBLE);
            } else {
                h.badge.setVisibility(View.GONE);
            }
            h.title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        }
    }
}
