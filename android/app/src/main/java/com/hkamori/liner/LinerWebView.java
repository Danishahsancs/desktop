package com.hkamori.liner;

import android.app.ActivityManager;
import android.content.Context;
import android.util.AttributeSet;
import com.capgo.mediasession.MediaSessionService;
import com.getcapacitor.CapacitorWebView;

/**
 * Chromium pauses media that starts while the page is hidden and resumes it when
 * the page is shown again. Every next track starts with the app in the background,
 * so playback stalled at each song change until the app was reopened. While the
 * media notification's foreground service is running we keep reporting the window
 * as visible, so the page isn't treated as hidden. Nothing is drawn while the
 * window is actually off screen, so this doesn't keep animations rendering.
 */
public class LinerWebView extends CapacitorWebView {
    public LinerWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (visibility != VISIBLE && isMediaServiceRunning()) {
            super.onWindowVisibilityChanged(VISIBLE);
            return;
        }
        super.onWindowVisibilityChanged(visibility);
    }

    @SuppressWarnings("deprecation") // still returns the caller's own services
    private boolean isMediaServiceRunning() {
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return false;
        for (ActivityManager.RunningServiceInfo info : manager.getRunningServices(Integer.MAX_VALUE)) {
            if (MediaSessionService.class.getName().equals(info.service.getClassName())) return true;
        }
        return false;
    }
}
