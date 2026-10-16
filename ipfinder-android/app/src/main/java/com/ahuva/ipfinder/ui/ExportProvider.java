package com.ahuva.ipfinder.ui;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import com.ahuva.ipfinder.core.Exporter;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;

/** Serves exported reports from cache/exports to the share sheet (read-only, per-URI grants). */
public class ExportProvider extends ContentProvider {
    public static final String AUTHORITY = "com.ahuva.ipfinder.export";

    static File dir(Context c) {
        File d = new File(c.getCacheDir(), "exports");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Writes the content to cache and returns a shareable content:// URI. */
    public static Uri write(Context c, String name, String content) throws IOException {
        File d = dir(c);
        File[] old = d.listFiles();
        if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 3600_000L) f.delete();
        File f = new File(d, name);
        FileOutputStream out = new FileOutputStream(f);
        try {
            out.write(content.getBytes("UTF-8"));
        } finally {
            out.close();
        }
        return Uri.parse("content://" + AUTHORITY + "/" + Uri.encode(name));
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..")) throw new FileNotFoundException();
        File f = new File(dir(getContext()), name);
        if (!f.exists()) throw new FileNotFoundException(name);
        return f;
    }

    @Override public boolean onCreate() {
        return true;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode != null && !mode.equals("r")) throw new SecurityException("read-only");
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri uri) {
        String n = String.valueOf(uri.getLastPathSegment());
        int dot = n.lastIndexOf('.');
        return Exporter.mime(dot >= 0 ? n.substring(dot + 1) : "txt");
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f;
        try {
            f = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        MatrixCursor c = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[]{f.getName(), f.length()});
        return c;
    }

    @Override public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
