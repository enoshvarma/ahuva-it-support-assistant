package com.ahuva.ipfinder.ui;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.TypedArray;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.content.res.ColorStateList;
import android.os.Build;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.Toolbar;

import com.ahuva.ipfinder.R;

/** View helpers: the app builds its screens in code to stay dependency-free and tiny. */
public final class Ui {
    private Ui() {}

    public static final int BRAND = 0xFF0B5CAD;
    public static final int ACCENT = 0xFF00BFA5;
    public static final int ONLINE = 0xFF2EB67D;
    public static final int OFFLINE = 0xFF8A9099;
    public static final int WARN = 0xFFF2A93B;
    public static final int DANGER = 0xFFE5484D;

    public static void applyTheme(Activity a) {
        String t = Prefs.get(a).theme();
        boolean light;
        if ("light".equals(t)) light = true;
        else if ("dark".equals(t)) light = false;
        else light = (a.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_NO;
        a.setTheme(light ? R.style.AppTheme_Light : R.style.AppTheme);
    }

    public static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }

    public static int attr(Context c, int attr) {
        TypedArray a = c.obtainStyledAttributes(new int[]{attr});
        try {
            return a.getColor(0, 0xFF888888);
        } finally {
            a.recycle();
        }
    }

    public static int textPrimary(Context c) { return attr(c, R.attr.appTextPrimary); }

    public static int textSecondary(Context c) { return attr(c, R.attr.appTextSecondary); }

    public static int surface(Context c) { return attr(c, R.attr.appSurface); }

    public static int surfaceAlt(Context c) { return attr(c, R.attr.appSurfaceAlt); }

    public static int divider(Context c) { return attr(c, R.attr.appDivider); }

    public static int background(Context c) { return attr(c, R.attr.appBackground); }

    /**
     * Root = [Toolbar][content]. Handles system bar / cutout / IME insets itself, so it looks right both with
     * the classic window layout (Android 5-14) and with enforced edge-to-edge (Android 15+).
     */
    public static FrameLayout setupScreen(final Activity a, CharSequence title, boolean back) {
        final LinearLayout root = new LinearLayout(a);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(attr(a, R.attr.appBar));
        Toolbar tb = new Toolbar(new android.view.ContextThemeWrapper(a, android.R.style.ThemeOverlay_Material_Dark_ActionBar),
                null, 0, R.style.Toolbar);
        tb.setPopupTheme(isLight(a) ? android.R.style.ThemeOverlay_Material_Light : android.R.style.ThemeOverlay_Material_Dark);
        tb.setTitle(title);
        tb.setBackgroundColor(attr(a, R.attr.appBar));
        root.addView(tb, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        FrameLayout content = new FrameLayout(a);
        content.setBackgroundColor(background(a));
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        a.setContentView(root);
        a.setActionBar(tb);
        if (back && a.getActionBar() != null) {
            a.getActionBar().setDisplayHomeAsUpEnabled(true);
        }
        tb.setNavigationOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                a.onBackPressed();
            }
        });
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                int l, t, r, b;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets i = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                            | WindowInsets.Type.ime());
                    l = i.left; t = i.top; r = i.right; b = i.bottom;
                } else {
                    l = in.getSystemWindowInsetLeft(); t = in.getSystemWindowInsetTop();
                    r = in.getSystemWindowInsetRight(); b = in.getSystemWindowInsetBottom();
                }
                v.setPadding(l, t, r, b);
                return in;
            }
        });
        return content;
    }

    public static TextView text(Context c, CharSequence s, float sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    public static TextView mono(Context c, CharSequence s, float sp, int color) {
        TextView t = text(c, s, sp, color, false);
        t.setTypeface(Typeface.MONOSPACE);
        return t;
    }

    public static TextView sectionTitle(Context c, String s) {
        TextView t = text(c, s.toUpperCase(java.util.Locale.getDefault()), 12, BRAND_TEXT(c), true);
        t.setLetterSpacing(0.08f);
        t.setPadding(dp(c, 4), dp(c, 16), dp(c, 4), dp(c, 6));
        return t;
    }

    private static int BRAND_TEXT(Context c) {
        return isLight(c) ? BRAND : 0xFF6FB3F2;
    }

    public static boolean isLight(Context c) {
        int bg = background(c);
        return ((bg >> 16) & 0xFF) > 0x80;
    }

    public static GradientDrawable round(int color, float radiusPx) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(radiusPx);
        return g;
    }

    public static GradientDrawable oval(int color) {
        GradientDrawable g = new GradientDrawable();
        g.setShape(GradientDrawable.OVAL);
        g.setColor(color);
        return g;
    }

    public static LinearLayout card(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setBackground(round(surface(c), dp(c, 14)));
        int p = dp(c, 14);
        l.setPadding(p, p, p, p);
        return l;
    }

    public static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    public static LinearLayout column(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    public static void ripple(View v, int bgColor, float radiusPx) {
        v.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33808080), round(bgColor, radiusPx), round(0xFFFFFFFF, radiusPx)));
    }

    public static Button button(Context c, String label, boolean primary) {
        Button b = new Button(c);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setMinHeight(dp(c, 44));
        b.setMinimumHeight(dp(c, 44));
        b.setPadding(dp(c, 16), 0, dp(c, 16), 0);
        b.setStateListAnimator(null);
        b.setTextColor(primary ? 0xFFFFFFFF : textPrimary(c));
        ripple(b, primary ? BRAND : surfaceAlt(c), dp(c, 12));
        return b;
    }

    public static TextView chip(Context c, String label, boolean selected) {
        TextView t = text(c, label, 13, selected ? 0xFFFFFFFF : textPrimary(c), selected);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(c, 12), dp(c, 7), dp(c, 12), dp(c, 7));
        t.setSingleLine(true);
        ripple(t, selected ? BRAND : surfaceAlt(c), dp(c, 16));
        t.setClickable(true);
        return t;
    }

    public static void setChipSelected(Context c, TextView t, boolean selected) {
        t.setTextColor(selected ? 0xFFFFFFFF : textPrimary(c));
        t.setTypeface(Typeface.DEFAULT, selected ? Typeface.BOLD : Typeface.NORMAL);
        ripple(t, selected ? BRAND : surfaceAlt(c), dp(c, 16));
    }

    public static EditText input(Context c, String hint, int inputType) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setInputType(inputType);
        e.setSingleLine(inputType != (InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE));
        e.setTextColor(textPrimary(c));
        e.setHintTextColor(textSecondary(c));
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        e.setPadding(dp(c, 12), dp(c, 10), dp(c, 12), dp(c, 10));
        e.setBackground(round(surfaceAlt(c), dp(c, 10)));
        return e;
    }

    public static LinearLayout.LayoutParams lp(int w, int h) {
        return new LinearLayout.LayoutParams(w, h);
    }

    public static LinearLayout.LayoutParams lpWeight(float weight) {
        return new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, weight);
    }

    public static LinearLayout.LayoutParams margins(LinearLayout.LayoutParams p, Context c, int l, int t, int r, int b) {
        p.setMargins(dp(c, l), dp(c, t), dp(c, r), dp(c, b));
        return p;
    }

    public static LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    public static LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    public static void toast(Context c, String s) {
        Toast.makeText(c.getApplicationContext(), s, Toast.LENGTH_SHORT).show();
    }

    public static void copy(Context c, String label, String value) {
        ClipboardManager cm = (ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null || value == null) return;
        cm.setPrimaryClip(ClipData.newPlainText(label, value));
        // Android 13+ shows its own clipboard confirmation.
        if (Build.VERSION.SDK_INT < 33) toast(c, "Copied " + value);
    }

    public interface TextCallback {
        void onText(String s);
    }

    public static void prompt(Context c, String title, String hint, String initial, int inputType, final TextCallback cb) {
        final EditText e = input(c, hint, inputType);
        if (initial != null) {
            e.setText(initial);
            e.setSelection(initial.length());
        }
        FrameLayout wrap = new FrameLayout(c);
        int p = dp(c, 20);
        wrap.setPadding(p, dp(c, 8), p, 0);
        wrap.addView(e);
        new AlertDialog.Builder(c).setTitle(title).setView(wrap)
                .setPositiveButton("OK", new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface d, int w) {
                        cb.onText(e.getText().toString().trim());
                    }
                })
                .setNegativeButton("Cancel", null).show();
    }

    public static View spacer(Context c, int heightDp) {
        View v = new View(c);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(c, heightDp)));
        return v;
    }

    public static View dividerLine(Context c) {
        View v = new View(c);
        v.setBackgroundColor(divider(c));
        v.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(c, 0.7f))));
        return v;
    }

    /** Circle avatar with one or two letters. */
    public static TextView avatar(Context c, String glyph, int color, int sizeDp) {
        TextView t = text(c, glyph, glyph.length() > 1 ? sizeDp / 3.4f : sizeDp / 2.6f, 0xFFFFFFFF, true);
        t.setGravity(Gravity.CENTER);
        t.setBackground(oval(color));
        t.setLayoutParams(new LinearLayout.LayoutParams(dp(c, sizeDp), dp(c, sizeDp)));
        return t;
    }
}
