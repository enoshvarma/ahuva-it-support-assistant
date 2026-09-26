package com.projectsarathi.gpscamera;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Draws the "Project Sarathi" GPS stamp. The same code draws the live preview overlay and the
 * stamp burned into the saved photo, so what you see is exactly what you get. All sizes are a
 * fraction of the target width, so it looks identical on a 1080 px screen and a 4000 px photo.
 */
public final class StampRenderer {

    private static final int ORANGE = 0xFFFF8F00;

    private final Paint boxPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint brandBgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint brandPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bodyPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint smallPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint mapPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint pinPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private static final class Line {
        final String text;
        final Paint paint;

        Line(String text, Paint paint) {
            this.text = text;
            this.paint = paint;
        }
    }

    public StampRenderer() {
        boxPaint.setColor(0xA6000000);
        brandBgPaint.setColor(ORANGE);
        brandPaint.setColor(Color.WHITE);
        brandPaint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        titlePaint.setColor(Color.WHITE);
        titlePaint.setTypeface(Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD));
        bodyPaint.setColor(Color.WHITE);
        bodyPaint.setTypeface(Typeface.SANS_SERIF);
        smallPaint.setColor(0xFFE0E0E0);
        smallPaint.setTypeface(Typeface.SANS_SERIF);
        pinPaint.setColor(0xFFE53935);
        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setColor(Color.WHITE);
    }

    // --- geometry, in units of 1% of the image width --------------------------------------------

    private static float unit(int width) {
        return width / 100f;
    }

    private void setSizes(float u) {
        brandPaint.setTextSize(3.1f * u);
        titlePaint.setTextSize(3.3f * u);
        bodyPaint.setTextSize(2.55f * u);
        smallPaint.setTextSize(2.35f * u);
        strokePaint.setStrokeWidth(0.3f * u);
    }

    private float mapSize(float u, StampData d) {
        return d.showMap ? 24f * u : 0f;
    }

    private List<Line> buildLines(StampData d, float maxTextWidth) {
        List<Line> lines = new ArrayList<>();
        String title = d.title == null || d.title.isEmpty()
                ? (d.hasFix ? "Locating address…" : "Waiting for GPS…") : d.title;
        for (String s : wrap(title, titlePaint, maxTextWidth, 1)) lines.add(new Line(s, titlePaint));
        if (d.address != null && !d.address.isEmpty()) {
            for (String s : wrap(d.address, bodyPaint, maxTextWidth, 2)) lines.add(new Line(s, bodyPaint));
        }
        if (d.hasFix) {
            lines.add(new Line(String.format(Locale.US, "Lat %.6f°  Long %.6f°", d.latitude, d.longitude), bodyPaint));
            lines.add(new Line("Plus Code: " + PlusCode.encode(d.latitude, d.longitude), bodyPaint));
        } else {
            lines.add(new Line("Lat --  Long --", bodyPaint));
        }
        lines.add(new Line(formatDate(d.timeMillis), bodyPaint));
        if (d.note != null && !d.note.trim().isEmpty()) {
            for (String s : wrap("Note: " + d.note.trim(), bodyPaint, maxTextWidth, 2)) lines.add(new Line(s, bodyPaint));
        }
        StringBuilder extra = new StringBuilder();
        if (d.hasFix && !Double.isNaN(d.altitude)) {
            extra.append(String.format(Locale.US, "Altitude %.0f m", d.altitude));
        }
        if (d.hasFix && !Float.isNaN(d.accuracy)) {
            if (extra.length() > 0) extra.append("   •   ");
            extra.append(String.format(Locale.US, "Accuracy ±%.0f m", d.accuracy));
        }
        if (extra.length() > 0) lines.add(new Line(extra.toString(), smallPaint));
        return lines;
    }

    private static float lineHeight(Paint p) {
        Paint.FontMetrics fm = p.getFontMetrics();
        return (fm.descent - fm.ascent) * 1.08f;
    }

    /** Height of the whole stamp (including its bottom margin) for an image of the given width. */
    public int measureHeight(int width, StampData d) {
        return (int) Math.ceil(layout(width, d).total);
    }

    private static final class Layout {
        float margin, pad, map, textX, textW, brandH, textH, boxH, total;
        List<Line> lines;
    }

    private Layout layout(int width, StampData d) {
        float u = unit(width);
        setSizes(u);
        Layout l = new Layout();
        l.margin = 2f * u;
        l.pad = 1.8f * u;
        l.map = mapSize(u, d);
        l.textX = l.margin + l.pad + (l.map > 0 ? l.map + l.pad : 0);
        l.textW = width - l.margin - l.pad - l.textX;
        l.brandH = lineHeight(brandPaint) + 1.0f * u;
        l.lines = buildLines(d, l.textW);
        float h = 0;
        for (Line line : l.lines) h += lineHeight(line.paint);
        l.textH = h;
        // The project badge straddles the box's top edge; its lower half eats into the text area.
        l.boxH = Math.max(l.map, l.textH + l.brandH * 0.5f) + 2 * l.pad;
        l.total = l.boxH + l.brandH * 0.5f + l.margin + 0.5f * u;
        return l;
    }

    /** Draws the stamp onto the bottom of a canvas of the given size. */
    public void draw(Canvas canvas, int width, int height, StampData d) {
        Layout l = layout(width, d);
        float u = unit(width);

        float boxBottom = height - l.margin;
        float boxTop = boxBottom - l.boxH;
        RectF box = new RectF(l.margin, boxTop, width - l.margin, boxBottom);
        canvas.drawRoundRect(box, 1.6f * u, 1.6f * u, boxPaint);

        // Project badge: orange pill straddling the box's top edge, e.g. "PROJECT SARATHI".
        String brand = (d.projectName == null || d.projectName.trim().isEmpty()
                ? "Project Sarathi" : d.projectName.trim()).toUpperCase(Locale.getDefault());
        brand = ellipsize(brand, brandPaint, width - 2 * l.margin - 4 * u);
        float brandW = brandPaint.measureText(brand) + 3.2f * u;
        RectF pill = new RectF(l.textX - 0.4f * u, boxTop - l.brandH * 0.5f,
                l.textX - 0.4f * u + brandW, boxTop + l.brandH * 0.5f);
        if (pill.right > width - l.margin - u) pill.offset(width - l.margin - u - pill.right, 0);
        canvas.drawRoundRect(pill, l.brandH * 0.5f, l.brandH * 0.5f, brandBgPaint);
        Paint.FontMetrics bfm = brandPaint.getFontMetrics();
        float brandBaseline = pill.centerY() - (bfm.ascent + bfm.descent) / 2f;
        canvas.drawText(brand, pill.left + 1.6f * u, brandBaseline, brandPaint);

        // Map thumbnail.
        if (l.map > 0) {
            float mapTop = boxTop + (l.boxH - l.map) / 2f;
            RectF mr = new RectF(l.margin + l.pad, mapTop, l.margin + l.pad + l.map, mapTop + l.map);
            drawMap(canvas, mr, d, u);
        }

        // Text lines, vertically centred below the badge.
        float inner = l.boxH - 2 * l.pad;
        float textBlock = l.textH + l.brandH * 0.5f;
        float y = boxTop + l.pad + (inner - textBlock) / 2f + l.brandH * 0.5f;
        for (Line line : l.lines) {
            Paint.FontMetrics fm = line.paint.getFontMetrics();
            canvas.drawText(line.text, l.textX, y - fm.ascent, line.paint);
            y += lineHeight(line.paint);
        }
    }

    private void drawMap(Canvas canvas, RectF r, StampData d, float u) {
        float radius = 1.2f * u;
        canvas.save();
        Path clip = new Path();
        clip.addRoundRect(r, radius, radius, Path.Direction.CW);
        canvas.clipPath(clip);
        if (d.map != null && !d.map.isRecycled()) {
            canvas.drawBitmap(d.map, new Rect(0, 0, d.map.getWidth(), d.map.getHeight()), r, mapPaint);
        } else {
            Paint bg = new Paint();
            bg.setColor(0xFF3A4A5A);
            canvas.drawRect(r, bg);
            Paint grid = new Paint(Paint.ANTI_ALIAS_FLAG);
            grid.setColor(0x33FFFFFF);
            grid.setStrokeWidth(0.25f * u);
            for (int i = 1; i < 4; i++) {
                float gx = r.left + r.width() * i / 4f;
                float gy = r.top + r.height() * i / 4f;
                canvas.drawLine(gx, r.top, gx, r.bottom, grid);
                canvas.drawLine(r.left, gy, r.right, gy, grid);
            }
        }
        if (d.hasFix || d.map == null) {
            drawPin(canvas, r.centerX(), r.centerY(), 2.2f * u);
        }
        if (d.map != null) {
            Paint attr = new Paint(Paint.ANTI_ALIAS_FLAG);
            attr.setTextSize(1.3f * u);
            attr.setColor(0xFF333333);
            String t = "© OpenStreetMap";
            float tw = attr.measureText(t);
            Paint attrBg = new Paint();
            attrBg.setColor(0xB3FFFFFF);
            canvas.drawRect(r.right - tw - 0.8f * u, r.bottom - 1.9f * u, r.right, r.bottom, attrBg);
            canvas.drawText(t, r.right - tw - 0.4f * u, r.bottom - 0.5f * u, attr);
        }
        canvas.restore();
        canvas.drawRoundRect(r, radius, radius, strokePaint);
    }

    /** Classic tear-drop map pin whose tip is at (cx, cy). */
    private void drawPin(Canvas canvas, float cx, float cy, float s) {
        Path p = new Path();
        float headY = cy - 1.6f * s;
        p.moveTo(cx, cy);
        p.cubicTo(cx - 0.35f * s, cy - 0.7f * s, cx - s, cy - 1.0f * s, cx - s, headY);
        p.cubicTo(cx - s, headY - 0.55f * s, cx - 0.55f * s, headY - s, cx, headY - s);
        p.cubicTo(cx + 0.55f * s, headY - s, cx + s, headY - 0.55f * s, cx + s, headY);
        p.cubicTo(cx + s, cy - 1.0f * s, cx + 0.35f * s, cy - 0.7f * s, cx, cy);
        p.close();
        canvas.drawPath(p, pinPaint);
        Paint dot = new Paint(Paint.ANTI_ALIAS_FLAG);
        dot.setColor(Color.WHITE);
        canvas.drawCircle(cx, headY, 0.38f * s, dot);
    }

    // --- text helpers ---------------------------------------------------------------------------

    static String formatDate(long millis) {
        Date date = new Date(millis);
        SimpleDateFormat f = new SimpleDateFormat("EEEE, dd/MM/yyyy hh:mm:ss a", Locale.getDefault());
        TimeZone tz = TimeZone.getDefault();
        f.setTimeZone(tz);
        int offsetMin = tz.getOffset(millis) / 60000;
        char sign = offsetMin >= 0 ? '+' : '-';
        offsetMin = Math.abs(offsetMin);
        return f.format(date) + String.format(Locale.US, " GMT %c%02d:%02d", sign, offsetMin / 60, offsetMin % 60);
    }

    private static String ellipsize(String text, Paint paint, float maxWidth) {
        if (paint.measureText(text) <= maxWidth) return text;
        String dots = "…";
        int n = paint.breakText(text, true, Math.max(0, maxWidth - paint.measureText(dots)), null);
        return text.substring(0, Math.max(0, n)).trim() + dots;
    }

    /** Word-wraps text into at most maxLines lines, ellipsizing the last one if needed. */
    static List<String> wrap(String text, Paint paint, float maxWidth, int maxLines) {
        List<String> out = new ArrayList<>();
        String rest = text.trim();
        while (!rest.isEmpty() && out.size() < maxLines) {
            if (out.size() == maxLines - 1 || paint.measureText(rest) <= maxWidth) {
                out.add(ellipsize(rest, paint, maxWidth));
                break;
            }
            int n = paint.breakText(rest, true, maxWidth, null);
            int cut = n;
            int space = rest.lastIndexOf(' ', n);
            int comma = rest.lastIndexOf(',', n - 1);
            int best = Math.max(space, comma + 1);
            if (best > n / 3) cut = best;
            if (cut <= 0) cut = Math.max(1, n);
            out.add(rest.substring(0, cut).trim());
            rest = rest.substring(cut).trim();
        }
        return out;
    }
}
