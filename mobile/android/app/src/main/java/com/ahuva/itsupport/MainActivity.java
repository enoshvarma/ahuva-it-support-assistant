package com.ahuva.itsupport;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.ahuva.itsupport.plugins.AhuvaNetworkPlugin;
import com.ahuva.itsupport.plugins.AhuvaSessionPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AhuvaSessionPlugin.class);
        registerPlugin(AhuvaNetworkPlugin.class);
        super.onCreate(savedInstanceState);

        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#07111f"));
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);

        // Android 15+ forces edge-to-edge and ignores adjustResize, so keep the WebView clear of
        // the status bar, gesture bar and keyboard ourselves. Older versions resize the window natively.
        if (Build.VERSION.SDK_INT >= 35) {
            View webView = getBridge().getWebView();
            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
                lp.topMargin = bars.top;
                lp.leftMargin = bars.left;
                lp.rightMargin = bars.right;
                lp.bottomMargin = Math.max(bars.bottom, ime.bottom);
                v.setLayoutParams(lp);
                return WindowInsetsCompat.CONSUMED;
            });
        }
    }
}
