package com.dwgviewer.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        normaliseShareIntent(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        normaliseShareIntent(intent);
        super.onNewIntent(intent);
    }

    // Files shared to the app ("Share -> DWG Viewer") arrive as ACTION_SEND with
    // EXTRA_STREAM. Turn them into ACTION_VIEW so the web layer receives them
    // through the same appUrlOpen event as "Open with".
    @SuppressWarnings("deprecation")
    private static void normaliseShareIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (stream == null) return;
        intent.setAction(Intent.ACTION_VIEW);
        intent.setDataAndType(stream, intent.getType());
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }
}
