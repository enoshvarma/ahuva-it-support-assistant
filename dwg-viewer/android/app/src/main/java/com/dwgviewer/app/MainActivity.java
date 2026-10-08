package com.dwgviewer.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "DWGViewer";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        prepareIncomingIntent(getIntent());
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        prepareIncomingIntent(intent);
        super.onNewIntent(intent);
    }

    // Drawings arrive as content:// URIs ("Open with") or ACTION_SEND streams ("Share").
    // Content URIs carry no file name and their read permission is temporary, so the
    // file is copied into the app cache under its real name and handed to the web layer
    // as a plain file:// URL through the normal appUrlOpen event.
    @SuppressWarnings("deprecation")
    private void prepareIncomingIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        } else if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            uri = intent.getData();
        }
        if (uri == null) return;
        if (!ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            if (Intent.ACTION_SEND.equals(intent.getAction())) {
                intent.setAction(Intent.ACTION_VIEW);
                intent.setData(uri);
            }
            return;
        }
        try {
            String name = displayName(uri);
            File dir = new File(getCacheDir(), "incoming");
            if (!dir.exists()) dir.mkdirs();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            File out = new File(dir, name);
            try (InputStream in = getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                if (in == null) return;
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            intent.setAction(Intent.ACTION_VIEW);
            intent.setData(Uri.fromFile(out));
        } catch (Exception e) {
            Log.w(TAG, "could not read shared drawing", e);
        }
    }

    private String displayName(Uri uri) {
        String name = null;
        try (Cursor c = getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "drawing";
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
        String lower = name.toLowerCase();
        if (!lower.endsWith(".dwg") && !lower.endsWith(".dxf")) name = name + ".dwg";
        return name;
    }
}
