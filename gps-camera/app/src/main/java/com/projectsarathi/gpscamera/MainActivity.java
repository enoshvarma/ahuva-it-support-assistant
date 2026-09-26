package com.projectsarathi.gpscamera;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.ImageFormat;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Size;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.google.common.util.concurrent.ListenableFuture;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class MainActivity extends AppCompatActivity implements LocationTracker.Callback {

    private static final int REQ_PERMS = 42;
    private static final String PREFS = "stamp";

    private PreviewView previewView;
    private StampView stampView;
    private TextView txtGpsStatus, txtPermission, txtBrand;
    private ImageButton btnFlash, btnShutter;
    private ImageView imgThumb;
    private View flashOverlay;
    private TextView[] zoomChips;

    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private ImageCapture imageCapture;
    private int lensFacing = CameraSelector.LENS_FACING_BACK;
    private int flashMode = ImageCapture.FLASH_MODE_OFF;
    private boolean capturing;

    private LocationTracker tracker;
    private Location location;
    private String title = "", address = "";
    private Location geocodedAt, mappedAt;
    private boolean geocoding, mapping;
    private Bitmap mapBitmap;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService network = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());
    private Uri lastPhoto;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            refreshStamp();
            main.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        applyEdgeToEdge();

        previewView = findViewById(R.id.previewView);
        stampView = findViewById(R.id.stampView);
        txtGpsStatus = findViewById(R.id.txtGpsStatus);
        txtPermission = findViewById(R.id.txtPermission);
        txtBrand = findViewById(R.id.txtBrand);
        btnFlash = findViewById(R.id.btnFlash);
        btnShutter = findViewById(R.id.btnShutter);
        imgThumb = findViewById(R.id.imgThumb);
        flashOverlay = findViewById(R.id.flashOverlay);
        zoomChips = new TextView[]{findViewById(R.id.zoom1), findViewById(R.id.zoom2), findViewById(R.id.zoom5)};

        // TextureView-backed preview: works on every device and lets the stamp overlay draw on top.
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);

        tracker = new LocationTracker(this, this);

        btnShutter.setOnClickListener(v -> takePhoto());
        btnFlash.setOnClickListener(v -> cycleFlash());
        findViewById(R.id.btnSwitch).setOnClickListener(v -> switchCamera());
        findViewById(R.id.btnSettings).setOnClickListener(v -> showSettings());
        findViewById(R.id.btnShare).setOnClickListener(v -> shareLast());
        imgThumb.setOnClickListener(v -> openLast());
        txtGpsStatus.setOnClickListener(v -> {
            if (!tracker.isGpsEnabled()) openLocationSettings();
        });
        float[] zooms = {1f, 2f, 5f};
        for (int i = 0; i < zoomChips.length; i++) {
            final float z = zooms[i];
            zoomChips[i].setOnClickListener(v -> setZoom(z));
        }
        zoomChips[0].setSelected(true);
        setupGestures();

        txtBrand.setText(projectName());
        refreshStamp();
        if (hasPermission(Manifest.permission.CAMERA)) {
            startCamera();
        }
        requestMissingPermissions();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasLocationPermission()) tracker.start();
        main.post(ticker);
    }

    @Override
    protected void onPause() {
        super.onPause();
        tracker.stop();
        main.removeCallbacks(ticker);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        worker.shutdown();
        network.shutdownNow();
    }

    private void applyEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View root = findViewById(R.id.root);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
        c.setAppearanceLightStatusBars(false);
        c.setAppearanceLightNavigationBars(false);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets b = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(b.left, b.top, b.right, b.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }

    // --- permissions ----------------------------------------------------------------------------

    private boolean hasPermission(String p) {
        return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasLocationPermission() {
        return hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                || hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    private void requestMissingPermissions() {
        List<String> need = new ArrayList<>();
        if (!hasPermission(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            need.add(Manifest.permission.ACCESS_FINE_LOCATION);
            need.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT <= 28 && !hasPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
            need.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        if (!need.isEmpty()) {
            ActivityCompat.requestPermissions(this, need.toArray(new String[0]), REQ_PERMS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_PERMS) return;
        if (hasPermission(Manifest.permission.CAMERA)) {
            txtPermission.setVisibility(View.GONE);
            if (cameraProvider == null) startCamera();
        } else {
            txtPermission.setVisibility(View.VISIBLE);
            txtPermission.setOnClickListener(v -> openAppSettings());
        }
        if (hasLocationPermission()) {
            tracker.start();
        }
        refreshStamp();
    }

    private void openAppSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null)));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private void openLocationSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    // --- camera ---------------------------------------------------------------------------------

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                cameraProvider = future.get();
                bindCamera();
            } catch (Exception e) {
                Toast.makeText(this, "Camera error: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void bindCamera() {
        if (cameraProvider == null) return;
        CameraSelector selector = new CameraSelector.Builder().requireLensFacing(lensFacing).build();
        try {
            if (!cameraProvider.hasCamera(selector)) {
                lensFacing = lensFacing == CameraSelector.LENS_FACING_BACK
                        ? CameraSelector.LENS_FACING_FRONT : CameraSelector.LENS_FACING_BACK;
                selector = new CameraSelector.Builder().requireLensFacing(lensFacing).build();
            }
        } catch (Exception ignored) {
        }

        ResolutionSelector previewRes = new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .build();
        ResolutionSelector photoRes = new ResolutionSelector.Builder()
                .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                .setResolutionStrategy(new ResolutionStrategy(new Size(4000, 3000),
                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
                .build();

        Preview preview = new Preview.Builder().setResolutionSelector(previewRes).build();
        imageCapture = new ImageCapture.Builder()
                .setResolutionSelector(photoRes)
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .setJpegQuality(95)
                .setFlashMode(flashMode)
                .setTargetRotation(previewView.getDisplay() != null
                        ? previewView.getDisplay().getRotation() : android.view.Surface.ROTATION_0)
                .build();

        try {
            cameraProvider.unbindAll();
            camera = cameraProvider.bindToLifecycle(this, selector, preview, imageCapture);
            preview.setSurfaceProvider(previewView.getSurfaceProvider());
            selectZoomChip(1f);
        } catch (Exception e) {
            Toast.makeText(this, "Could not open camera: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void switchCamera() {
        lensFacing = lensFacing == CameraSelector.LENS_FACING_BACK
                ? CameraSelector.LENS_FACING_FRONT : CameraSelector.LENS_FACING_BACK;
        bindCamera();
    }

    private void cycleFlash() {
        if (flashMode == ImageCapture.FLASH_MODE_OFF) {
            flashMode = ImageCapture.FLASH_MODE_AUTO;
            btnFlash.setImageResource(R.drawable.ic_flash_auto);
        } else if (flashMode == ImageCapture.FLASH_MODE_AUTO) {
            flashMode = ImageCapture.FLASH_MODE_ON;
            btnFlash.setImageResource(R.drawable.ic_flash_on);
        } else {
            flashMode = ImageCapture.FLASH_MODE_OFF;
            btnFlash.setImageResource(R.drawable.ic_flash_off);
        }
        if (imageCapture != null) imageCapture.setFlashMode(flashMode);
    }

    private void setZoom(float ratio) {
        if (camera == null) return;
        ZoomState zs = camera.getCameraInfo().getZoomState().getValue();
        float r = ratio;
        if (zs != null) r = Math.max(zs.getMinZoomRatio(), Math.min(zs.getMaxZoomRatio(), ratio));
        camera.getCameraControl().setZoomRatio(r);
        selectZoomChip(ratio);
    }

    private void selectZoomChip(float ratio) {
        float[] zooms = {1f, 2f, 5f};
        for (int i = 0; i < zoomChips.length; i++) zoomChips[i].setSelected(Math.abs(zooms[i] - ratio) < 0.05f);
    }

    @SuppressLint("ClickableViewAccessibility")
    private void setupGestures() {
        ScaleGestureDetector scale = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(ScaleGestureDetector detector) {
                if (camera == null) return false;
                ZoomState zs = camera.getCameraInfo().getZoomState().getValue();
                if (zs == null) return false;
                float r = Math.max(zs.getMinZoomRatio(), Math.min(zs.getMaxZoomRatio(), zs.getZoomRatio() * detector.getScaleFactor()));
                camera.getCameraControl().setZoomRatio(r);
                selectZoomChip(r);
                return true;
            }
        });
        previewView.setOnTouchListener((v, event) -> {
            scale.onTouchEvent(event);
            if (event.getAction() == MotionEvent.ACTION_UP && !scale.isInProgress() && event.getPointerCount() == 1
                    && camera != null) {
                try {
                    MeteringPoint p = previewView.getMeteringPointFactory().createPoint(event.getX(), event.getY());
                    camera.getCameraControl().startFocusAndMetering(new FocusMeteringAction.Builder(p)
                            .setAutoCancelDuration(4, TimeUnit.SECONDS).build());
                } catch (Exception ignored) {
                }
                v.performClick();
            }
            return true;
        });
    }

    /** Volume keys and the hardware camera key work as a shutter, like most camera apps. */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_UP
                || keyCode == KeyEvent.KEYCODE_CAMERA) {
            if (event.getRepeatCount() == 0) takePhoto();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void takePhoto() {
        if (imageCapture == null || capturing) {
            if (!hasPermission(Manifest.permission.CAMERA)) requestMissingPermissions();
            return;
        }
        capturing = true;
        btnShutter.setEnabled(false);
        final StampData stamp = currentStamp().withTime(System.currentTimeMillis());
        final Location loc = location;
        flashOverlay.setAlpha(0.8f);
        flashOverlay.animate().alpha(0f).setDuration(250).start();

        imageCapture.takePicture(worker, new ImageCapture.OnImageCapturedCallback() {
            @Override
            public void onCaptureSuccess(@NonNull ImageProxy image) {
                byte[] jpeg;
                int rotation;
                try {
                    rotation = image.getImageInfo().getRotationDegrees();
                    if (image.getFormat() != ImageFormat.JPEG) throw new IllegalStateException("Unexpected format");
                    ByteBuffer buf = image.getPlanes()[0].getBuffer();
                    buf.rewind();
                    jpeg = new byte[buf.remaining()];
                    buf.get(jpeg);
                } catch (Exception e) {
                    image.close();
                    onSaveFailed(e);
                    return;
                }
                image.close();
                try {
                    PhotoSaver.Saved saved = PhotoSaver.process(MainActivity.this, jpeg, rotation, false, stamp, loc);
                    main.post(() -> onSaved(saved));
                } catch (Throwable e) {
                    onSaveFailed(e);
                }
            }

            @Override
            public void onError(@NonNull ImageCaptureException e) {
                onSaveFailed(e);
            }
        });
    }

    private void onSaved(PhotoSaver.Saved saved) {
        capturing = false;
        btnShutter.setEnabled(true);
        lastPhoto = saved.uri;
        imgThumb.setImageBitmap(saved.thumbnail);
        Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show();
    }

    private void onSaveFailed(Throwable e) {
        main.post(() -> {
            capturing = false;
            btnShutter.setEnabled(true);
            Toast.makeText(this, getString(R.string.save_failed) + ": " + e.getMessage(), Toast.LENGTH_LONG).show();
        });
    }

    private void openLast() {
        if (lastPhoto == null) {
            Toast.makeText(this, R.string.no_photo_yet, Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(lastPhoto, "image/jpeg");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No gallery app found", Toast.LENGTH_SHORT).show();
        }
    }

    private void shareLast() {
        if (lastPhoto == null) {
            Toast.makeText(this, R.string.no_photo_yet, Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("image/jpeg");
        i.putExtra(Intent.EXTRA_STREAM, lastPhoto);
        i.putExtra(Intent.EXTRA_TEXT, shareText());
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(i, "Share photo"));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private String shareText() {
        StringBuilder sb = new StringBuilder(projectName());
        if (!address.isEmpty()) sb.append("\n").append(address);
        if (location != null) {
            sb.append(String.format(java.util.Locale.US, "\nhttps://maps.google.com/?q=%.6f,%.6f",
                    location.getLatitude(), location.getLongitude()));
        }
        return sb.toString();
    }

    // --- location, address and map --------------------------------------------------------------

    @Override
    public void onLocation(Location loc) {
        location = loc;
        if (!geocoding && (geocodedAt == null || geocodedAt.distanceTo(loc) > 25)) lookupAddress(loc);
        if (!mapping && prefs().getBoolean("showMap", true)
                && (mappedAt == null || mappedAt.distanceTo(loc) > 20)) loadMap(loc);
        refreshStamp();
    }

    private void lookupAddress(Location loc) {
        geocoding = true;
        final double lat = loc.getLatitude(), lng = loc.getLongitude();
        network.execute(() -> {
            AddressLookup.Result r = AddressLookup.lookup(getApplicationContext(), lat, lng);
            main.post(() -> {
                geocoding = false;
                if (r != null) {
                    title = r.title;
                    address = r.address;
                    geocodedAt = loc;
                } else {
                    // Retry on the next fix after a short pause (e.g. network came back).
                    main.postDelayed(() -> geocodedAt = null, 10000);
                    geocodedAt = loc;
                }
                refreshStamp();
            });
        });
    }

    private final MapTileLoader tiles = new MapTileLoader();

    private void loadMap(Location loc) {
        mapping = true;
        final double lat = loc.getLatitude(), lng = loc.getLongitude();
        network.execute(() -> {
            Bitmap b = tiles.render(lat, lng);
            main.post(() -> {
                mapping = false;
                if (b != null) {
                    mapBitmap = b;
                    mappedAt = loc;
                } else {
                    mappedAt = loc;
                    main.postDelayed(() -> mappedAt = null, 10000);
                }
                refreshStamp();
            });
        });
    }

    // --- stamp ----------------------------------------------------------------------------------

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String projectName() {
        String p = prefs().getString("project", "");
        return p == null || p.trim().isEmpty() ? getString(R.string.default_project) : p.trim();
    }

    private StampData currentStamp() {
        SharedPreferences sp = prefs();
        boolean hasFix = location != null;
        String t = title;
        if (!hasFix && !hasLocationPermission()) t = "Location permission not granted";
        else if (!hasFix && !tracker.isGpsEnabled()) t = "Location is turned off";
        return new StampData(
                projectName(), t, address, hasFix,
                hasFix ? location.getLatitude() : 0, hasFix ? location.getLongitude() : 0,
                hasFix && location.hasAltitude() ? location.getAltitude() : Double.NaN,
                hasFix && location.hasAccuracy() ? location.getAccuracy() : Float.NaN,
                System.currentTimeMillis(),
                sp.getString("note", ""),
                mapBitmap,
                sp.getBoolean("showMap", true));
    }

    private void refreshStamp() {
        stampView.setData(currentStamp());
        if (location != null) {
            txtGpsStatus.setText(location.hasAccuracy()
                    ? String.format(java.util.Locale.US, "GPS ±%.0f m", location.getAccuracy()) : "GPS locked");
            txtGpsStatus.setTextColor(0xFF81C784);
        } else if (!hasLocationPermission()) {
            txtGpsStatus.setText("Location permission needed");
            txtGpsStatus.setTextColor(0xFFE57373);
        } else if (!tracker.isGpsEnabled()) {
            txtGpsStatus.setText("Turn on Location (tap)");
            txtGpsStatus.setTextColor(0xFFE57373);
        } else {
            txtGpsStatus.setText(R.string.waiting_gps);
            txtGpsStatus.setTextColor(0xFFFFB74D);
        }
    }

    private void showSettings() {
        SharedPreferences sp = prefs();
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad / 2, pad, 0);

        TextView l1 = new TextView(this);
        l1.setText(R.string.project_name);
        EditText project = new EditText(this);
        project.setSingleLine(true);
        project.setText(projectName());

        TextView l2 = new TextView(this);
        l2.setText(R.string.note);
        l2.setPadding(0, pad / 2, 0, 0);
        EditText note = new EditText(this);
        note.setText(sp.getString("note", ""));
        note.setHint("e.g. Site inspection – Block A");

        CheckBox map = new CheckBox(this);
        map.setText(R.string.show_map);
        map.setChecked(sp.getBoolean("showMap", true));

        box.addView(l1);
        box.addView(project);
        box.addView(l2);
        box.addView(note);
        box.addView(map);

        new AlertDialog.Builder(this)
                .setTitle(R.string.settings)
                .setView(box)
                .setPositiveButton(R.string.save, (d, w) -> {
                    sp.edit()
                            .putString("project", project.getText().toString().trim())
                            .putString("note", note.getText().toString().trim())
                            .putBoolean("showMap", map.isChecked())
                            .apply();
                    txtBrand.setText(projectName());
                    if (map.isChecked() && location != null && mapBitmap == null && !mapping) loadMap(location);
                    refreshStamp();
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }
}
