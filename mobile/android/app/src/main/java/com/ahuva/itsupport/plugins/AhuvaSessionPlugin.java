package com.ahuva.itsupport.plugins;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.ahuva.itsupport.BuildConfig;
import com.ahuva.itsupport.core.DeviceConnection;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.hoho.android.usbserial.driver.UsbSerialDriver;
import com.hoho.android.usbserial.driver.UsbSerialPort;
import com.hoho.android.usbserial.driver.UsbSerialProber;
import com.hoho.android.usbserial.util.SerialInputOutputManager;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AhuvaSession")
public class AhuvaSessionPlugin extends Plugin implements DeviceConnection.Listener {
    private static final String TAG = "AhuvaSession";
    private static final String ACTION_USB_PERMISSION = "com.ahuva.itsupport.USB_PERMISSION";

    private final ExecutorService connectExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private DeviceConnection network;

    private UsbSerialPort serialPort;
    private UsbDeviceConnection serialConnection;
    private SerialInputOutputManager serialIo;
    private int serialDeviceId = -1;
    private volatile boolean serialConnected;
    private BroadcastReceiver detachReceiver;

    @Override
    public void load() {
        network = new DeviceConnection(this);
    }

    // ── DeviceConnection.Listener ──────────────────────────────────────────
    @Override public void onData(String text) { emitData(text); }
    @Override public void onClosed(String reason) { emitClosed(reason); }
    @Override public void onError(String message) { emitError(message); }

    private void emitData(String text) {
        JSObject ev = new JSObject();
        ev.put("data", text);
        notifyListeners("sessionData", ev);
    }

    private void emitClosed(String reason) {
        JSObject ev = new JSObject();
        ev.put("reason", reason);
        notifyListeners("sessionClosed", ev);
    }

    private void emitError(String message) {
        JSObject ev = new JSObject();
        ev.put("message", message);
        notifyListeners("sessionError", ev);
    }

    // ── Connect / disconnect ───────────────────────────────────────────────
    @PluginMethod
    public void connect(PluginCall call) {
        final String connType = call.getString("connType", "");
        final String host = call.getString("host", "");
        final String username = call.getString("username", "");
        final String password = call.getString("password", "");
        final String comPort = call.getString("comPort", "");
        final int port = parseInt(call.getData().opt("port"), "telnet".equals(connType) ? 23 : 22);
        final int baud = parseInt(call.getData().opt("baudRate"), 9600);

        connectExecutor.execute(() -> {
            try {
                closeAll();
                if ("ssh".equals(connType)) {
                    network.connectSSH(host, port, username, password);
                } else if ("telnet".equals(connType)) {
                    network.connectTelnet(host, port);
                } else if ("serial".equals(connType)) {
                    connectSerial(comPort, baud);
                } else {
                    call.reject("Unknown connection type: \"" + connType + "\"");
                    return;
                }
                call.resolve(new JSObject().put("ok", true));
            } catch (Exception e) {
                Log.w(TAG, "Connect failed", e);
                call.reject(friendly(e));
            }
        });
    }

    private static String friendly(Exception e) {
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        if (m.contains("Auth fail") || m.contains("Auth cancel")) return "Authentication failed — check the username and password.";
        if (e instanceof java.net.UnknownHostException) return "Unknown host: " + m;
        if (e instanceof java.net.ConnectException || m.contains("ECONNREFUSED") || m.contains("Connection refused")) return "Connection refused — is SSH/Telnet enabled on the device and the port correct?";
        if (m.contains("timeout") || m.contains("timed out")) return "Connection timed out — check the IP address and that your phone is on the same network.";
        return m;
    }

    private static int parseInt(Object v, int fallback) {
        if (v == null) return fallback;
        try { return Integer.parseInt(String.valueOf(v).trim()); } catch (NumberFormatException e) { return fallback; }
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        connectExecutor.execute(() -> {
            closeAll();
            call.resolve(new JSObject().put("ok", true));
        });
    }

    private void closeAll() {
        network.disconnect();
        closeSerial();
    }

    @PluginMethod
    public void write(PluginCall call) {
        final String data = call.getString("data", "");
        ioExecutor.execute(() -> {
            try {
                writeRaw(data);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Write failed" : e.getMessage());
            }
        });
    }

    private void writeRaw(String data) throws IOException {
        if (serialConnected && serialPort != null) {
            serialPort.write(data.getBytes(StandardCharsets.UTF_8), 2000);
        } else {
            network.write(data);
        }
    }

    @Override
    protected void handleOnDestroy() {
        closeAll();
        connectExecutor.shutdownNow();
        ioExecutor.shutdownNow();
    }

    // ── USB serial console (USB-OTG cable) ────────────────────────────────
    private UsbManager usb() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    @PluginMethod
    public void listSerialPorts(PluginCall call) {
        JSArray ports = new JSArray();
        try {
            List<UsbSerialDriver> drivers = UsbSerialProber.getDefaultProber().findAllDrivers(usb());
            for (UsbSerialDriver d : drivers) {
                UsbDevice dev = d.getDevice();
                String product = dev.getProductName() != null ? dev.getProductName() : "";
                String driver = d.getClass().getSimpleName().replace("SerialDriver", "");
                for (int i = 0; i < d.getPorts().size(); i++) {
                    JSObject p = new JSObject();
                    p.put("path", "usb:" + dev.getDeviceId() + ":" + i);
                    String label = (product.isEmpty() ? driver + " USB serial" : product) + (d.getPorts().size() > 1 ? " (port " + (i + 1) + ")" : "");
                    p.put("friendly", label);
                    ports.put(p);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "USB enumeration failed", e);
        }
        call.resolve(new JSObject().put("ports", ports));
    }

    private void connectSerial(String path, int baud) throws Exception {
        String[] parts = path.split(":");
        if (parts.length != 3 || !"usb".equals(parts[0])) throw new IOException("Select a USB console cable from the list (tap refresh after plugging it in).");
        int deviceId = Integer.parseInt(parts[1]);
        int portIndex = Integer.parseInt(parts[2]);

        UsbSerialDriver driver = null;
        for (UsbSerialDriver d : UsbSerialProber.getDefaultProber().findAllDrivers(usb())) {
            if (d.getDevice().getDeviceId() == deviceId) { driver = d; break; }
        }
        if (driver == null) throw new IOException("USB console cable not found — reconnect it and tap refresh.");
        if (portIndex >= driver.getPorts().size()) throw new IOException("USB port not available.");
        UsbDevice device = driver.getDevice();

        if (!usb().hasPermission(device) && !requestUsbPermission(device)) {
            throw new IOException("USB permission denied — allow access to the console cable when Android asks.");
        }
        UsbDeviceConnection conn = usb().openDevice(device);
        if (conn == null) throw new IOException("Could not open the USB device.");
        UsbSerialPort port = driver.getPorts().get(portIndex);
        try {
            port.open(conn);
            port.setParameters(baud, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE);
            try { port.setDTR(true); port.setRTS(true); } catch (Exception ignored) {}
        } catch (Exception e) {
            try { port.close(); } catch (Exception ignored) {}
            conn.close();
            throw e;
        }
        serialPort = port;
        serialConnection = conn;
        serialDeviceId = deviceId;
        serialConnected = true;

        final DeviceConnection.Utf8Stream decoder = new DeviceConnection.Utf8Stream();
        serialIo = new SerialInputOutputManager(port, new SerialInputOutputManager.Listener() {
            @Override public void onNewData(byte[] data) {
                String text = decoder.decode(data, data.length);
                if (!text.isEmpty()) emitData(text);
            }
            @Override public void onRunError(Exception e) {
                if (serialConnected) {
                    closeSerial();
                    emitClosed("Serial port closed");
                }
            }
        });
        serialIo.start();
        registerDetachReceiver();
        port.write("\r".getBytes(StandardCharsets.US_ASCII), 1000);
    }

    private boolean requestUsbPermission(UsbDevice device) throws InterruptedException {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicBoolean granted = new AtomicBoolean(false);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                granted.set(intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false));
                latch.countDown();
            }
        };
        ContextCompat.registerReceiver(getContext(), receiver, new IntentFilter(ACTION_USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED);
        try {
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(getContext().getPackageName());
            PendingIntent pi = PendingIntent.getBroadcast(getContext(), 0, intent, flags);
            usb().requestPermission(device, pi);
            latch.await(60, TimeUnit.SECONDS);
        } finally {
            try { getContext().unregisterReceiver(receiver); } catch (Exception ignored) {}
        }
        return granted.get() || usb().hasPermission(device);
    }

    private void registerDetachReceiver() {
        if (detachReceiver != null) return;
        detachReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                UsbDevice dev = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (dev != null && dev.getDeviceId() == serialDeviceId && serialConnected) {
                    closeSerial();
                    emitClosed("Serial port closed (cable unplugged)");
                }
            }
        };
        ContextCompat.registerReceiver(getContext(), detachReceiver, new IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    private synchronized void closeSerial() {
        serialConnected = false;
        if (serialIo != null) { try { serialIo.stop(); } catch (Exception ignored) {} }
        if (serialPort != null) { try { serialPort.close(); } catch (Exception ignored) {} }
        if (serialConnection != null) { try { serialConnection.close(); } catch (Exception ignored) {} }
        serialIo = null; serialPort = null; serialConnection = null; serialDeviceId = -1;
        if (detachReceiver != null) {
            try { getContext().unregisterReceiver(detachReceiver); } catch (Exception ignored) {}
            detachReceiver = null;
        }
    }

    // ── Files / links ──────────────────────────────────────────────────────
    @PluginMethod
    public void saveTextFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/plain");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "backup.txt"));
        startActivityForResult(call, intent, "onSaveTextFile");
    }

    @ActivityCallback
    private void onSaveTextFile(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("path", JSObject.NULL));
            return;
        }
        Uri uri = result.getData().getData();
        byte[] bytes = call.getString("text", "").getBytes(StandardCharsets.UTF_8);
        try {
            OutputStream os;
            try { os = getContext().getContentResolver().openOutputStream(uri, "wt"); }
            catch (Exception e) { os = getContext().getContentResolver().openOutputStream(uri, "w"); }
            if (os == null) throw new IOException("Could not open the chosen file.");
            try { os.write(bytes); } finally { os.close(); }
            call.resolve(new JSObject().put("path", displayName(uri)));
        } catch (Exception e) {
            call.reject("Could not save file: " + e.getMessage());
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return uri.getLastPathSegment();
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("ok", true));
        } catch (ActivityNotFoundException e) {
            call.resolve(new JSObject().put("ok", false).put("error", "No app installed that can open " + Uri.parse(url).getScheme() + ":// links."));
        } catch (Exception e) {
            call.resolve(new JSObject().put("ok", false).put("error", e.getMessage()));
        }
    }

    // ── Diagnostics ────────────────────────────────────────────────────────
    @PluginMethod
    public void reportStatus(PluginCall call) {
        String tag = call.getBoolean("selftest", false) ? "AhuvaSelfTest" : "AhuvaStatus";
        String msg = call.getString("message", "");
        if (call.getBoolean("error", false)) Log.w(tag, msg); else Log.i(tag, msg);
        call.resolve();
    }

    /** Self-test hook exists only in the CI "selftest" build type; release builds always return null. */
    @PluginMethod
    public void selfTestConfig(PluginCall call) {
        JSObject ret = new JSObject();
        String host = null;
        if (BuildConfig.SELFTEST && getActivity() != null && getActivity().getIntent() != null) {
            host = getActivity().getIntent().getStringExtra("selftestHost");
        }
        ret.put("host", host == null ? JSObject.NULL : host);
        call.resolve(ret);
    }
}
