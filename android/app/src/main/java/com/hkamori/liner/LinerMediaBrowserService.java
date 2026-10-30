package com.hkamori.liner;

import android.content.ComponentName;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media.MediaBrowserServiceCompat;
import com.capgo.mediasession.MediaSessionService;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;

/**
 * Android Auto entry point. Auto lists media apps through a MediaBrowserService
 * and drives them through its media session. Liner's session already exists:
 * the media-session plugin's service (the notification playbar) owns it while
 * something is playing or paused. This service attaches to that service and
 * hands its session token to Auto, so Auto shows what's playing and its
 * play / pause / skip / seek buttons go through the same handlers as the
 * notification.
 *
 * Playback itself runs in the app's webview, so the app has to have been opened
 * on the phone: until then Auto waits for the session (the connection is held
 * until setSessionToken is called).
 */
public class LinerMediaBrowserService extends MediaBrowserServiceCompat {
    private static final String TAG = "LinerAuto";
    private static final String ROOT_ID = "liner-root";
    private static final long RETRY_MS = 1000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private IBinder pluginBinder;
    private boolean tokenSet;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            pluginBinder = binder;
            attachSession();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            pluginBinder = null;
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        // flags 0: don't create the plugin service ourselves; connect whenever the
        // app starts it (on playback) and stay connected across restarts of it
        bindService(new Intent(this, MediaSessionService.class), connection, 0);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        try {
            unbindService(connection);
        } catch (IllegalArgumentException ignored) {
            // never bound
        }
        super.onDestroy();
    }

    // the plugin creates its session when the app connects to it, which can be
    // a moment after its service starts, so retry until it exists
    private void attachSession() {
        if (tokenSet || pluginBinder == null) return;
        MediaSessionCompat session = readPluginSession(pluginBinder);
        if (session == null) {
            handler.postDelayed(this::attachSession, RETRY_MS);
            return;
        }
        setSessionToken(session.getSessionToken());
        tokenSet = true;
        Log.i(TAG, "media session handed to android auto");
    }

    // the plugin keeps its service accessor package-private and the session in a
    // private field; @capgo/capacitor-media-session is pinned in package.json
    @Nullable
    private static MediaSessionCompat readPluginSession(IBinder binder) {
        try {
            Method getService = binder.getClass().getDeclaredMethod("getService");
            getService.setAccessible(true);
            Object service = getService.invoke(binder);
            if (service == null) return null;
            Field field = MediaSessionService.class.getDeclaredField("mediaSession");
            field.setAccessible(true);
            return (MediaSessionCompat) field.get(service);
        } catch (ReflectiveOperationException | ClassCastException e) {
            Log.w(TAG, "media session not reachable", e);
            return null;
        }
    }

    @Nullable
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, @Nullable Bundle rootHints) {
        return new BrowserRoot(ROOT_ID, null);
    }

    // no library browsing in the car yet: auto shows the now-playing screen
    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<java.util.List<MediaBrowserCompat.MediaItem>> result) {
        result.sendResult(new ArrayList<>());
    }
}
