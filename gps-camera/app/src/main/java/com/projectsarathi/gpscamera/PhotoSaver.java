package com.projectsarathi.gpscamera;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.location.Location;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.core.content.FileProvider;
import androidx.exifinterface.media.ExifInterface;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Stamps a captured JPEG and saves it to Pictures/ProjectSarathi with GPS EXIF tags. */
public final class PhotoSaver {

    public static final String ALBUM = "ProjectSarathi";
    private static final int MAX_DIMENSION = 4096; // keeps memory safe on low-end phones

    private PhotoSaver() {
    }

    public static final class Saved {
        public final Uri uri;
        public final Bitmap thumbnail;

        Saved(Uri uri, Bitmap thumbnail) {
            this.uri = uri;
            this.thumbnail = thumbnail;
        }
    }

    /** Blocking. Returns a content:// Uri that other apps can open plus a thumbnail, or throws. */
    public static Saved process(Context context, byte[] jpeg, int rotationDegrees, boolean mirror,
                              StampData stamp, Location location) throws Exception {
        return processBitmap(context, decode(jpeg, rotationDegrees, mirror), stamp, location);
    }

    /** Same as {@link #process} for an already-decoded, upright bitmap (e.g. a preview frame). */
    public static Saved processBitmap(Context context, Bitmap photo, StampData stamp,
                                      Location location) throws Exception {
        if (!photo.isMutable()) {
            Bitmap copy = photo.copy(Bitmap.Config.ARGB_8888, true);
            photo.recycle();
            photo = copy;
        }
        Canvas canvas = new Canvas(photo);
        new StampRenderer().draw(canvas, photo.getWidth(), photo.getHeight(), stamp);
        int tw = 240;
        Bitmap thumb = Bitmap.createScaledBitmap(photo, tw, Math.max(1, tw * photo.getHeight() / photo.getWidth()), true);

        long now = stamp.timeMillis;
        String name = "Sarathi_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date(now));

        File tmp = new File(context.getCacheDir(), name + ".jpg");
        FileOutputStream fos = new FileOutputStream(tmp);
        try {
            photo.compress(Bitmap.CompressFormat.JPEG, 92, fos);
        } finally {
            fos.close();
            photo.recycle();
        }
        writeExif(tmp, stamp, location);
        try {
            return new Saved(publish(context, tmp, name), thumb);
        } finally {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        }
    }

    private static Bitmap decode(byte[] jpeg, int rotation, boolean mirror) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, bounds);
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > MAX_DIMENSION) sample *= 2;

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        opts.inMutable = true;
        Bitmap src = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, opts);
        if (src == null) throw new IllegalStateException("Could not decode camera image");

        if (rotation % 360 == 0 && !mirror) {
            if (src.isMutable()) return src;
            Bitmap copy = src.copy(Bitmap.Config.ARGB_8888, true);
            src.recycle();
            return copy;
        }
        Matrix m = new Matrix();
        m.postRotate(rotation);
        if (mirror) m.postScale(-1, 1);
        Bitmap rotated = Bitmap.createBitmap(src, 0, 0, src.getWidth(), src.getHeight(), m, true);
        if (rotated != src) src.recycle();
        if (!rotated.isMutable()) {
            Bitmap copy = rotated.copy(Bitmap.Config.ARGB_8888, true);
            rotated.recycle();
            rotated = copy;
        }
        return rotated;
    }

    private static void writeExif(File file, StampData stamp, Location location) {
        try {
            ExifInterface exif = new ExifInterface(file.getAbsolutePath());
            if (location != null) exif.setGpsInfo(location);
            String dt = new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US).format(new Date(stamp.timeMillis));
            exif.setAttribute(ExifInterface.TAG_DATETIME, dt);
            exif.setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, dt);
            exif.setAttribute(ExifInterface.TAG_MAKE, Build.MANUFACTURER);
            exif.setAttribute(ExifInterface.TAG_MODEL, Build.MODEL);
            exif.setAttribute(ExifInterface.TAG_SOFTWARE, "Project Sarathi GPS Camera");
            StringBuilder desc = new StringBuilder(stamp.projectName == null ? "" : stamp.projectName);
            if (stamp.address != null && !stamp.address.isEmpty()) desc.append(" | ").append(stamp.address);
            if (stamp.note != null && !stamp.note.trim().isEmpty()) desc.append(" | ").append(stamp.note.trim());
            exif.setAttribute(ExifInterface.TAG_IMAGE_DESCRIPTION, desc.toString());
            exif.setAttribute(ExifInterface.TAG_ORIENTATION, String.valueOf(ExifInterface.ORIENTATION_NORMAL));
            exif.saveAttributes();
        } catch (Throwable ignored) {
            // The stamp is already burned into the pixels; EXIF is a bonus.
        }
    }

    private static Uri publish(Context context, File tmp, String name) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = context.getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.DISPLAY_NAME, name + ".jpg");
            v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
            v.put(MediaStore.Images.Media.IS_PENDING, 1);
            Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IllegalStateException("MediaStore insert failed");
            try {
                OutputStream out = cr.openOutputStream(uri);
                if (out == null) throw new IllegalStateException("Cannot open output");
                copy(tmp, out);
                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, done, null, null);
                return uri;
            } catch (Exception e) {
                cr.delete(uri, null, null);
                throw e;
            }
        }
        // Android 9 and older: write the file into the public Pictures folder and index it.
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("Cannot create " + dir);
        File dest = new File(dir, name + ".jpg");
        int i = 1;
        while (dest.exists()) dest = new File(dir, name + "_" + (i++) + ".jpg");
        copy(tmp, new FileOutputStream(dest));
        MediaScannerConnection.scanFile(context, new String[]{dest.getAbsolutePath()},
                new String[]{"image/jpeg"}, null);
        return FileProvider.getUriForFile(context, context.getPackageName() + ".files", dest);
    }

    private static void copy(File from, OutputStream out) throws Exception {
        InputStream in = new FileInputStream(from);
        try {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } finally {
            in.close();
            out.close();
        }
    }
}
