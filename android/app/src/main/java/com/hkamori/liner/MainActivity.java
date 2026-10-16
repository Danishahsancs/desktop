package com.hkamori.liner;

import android.content.Intent;
import android.os.Bundle;
import com.capgo.mediasession.MediaSessionService;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // the ui is laid out in px, so android's system font scale (samsung's
        // "font size" slider) would overflow rows and buttons; the app scales
        // its own type for phones instead
        getBridge().getWebView().getSettings().setTextZoom(100);
    }

    @Override
    public void onDestroy() {
        // swiped away from recents: the webview (and its audio) goes with the
        // activity, so drop the media notification instead of leaving a stuck one
        if (isFinishing()) {
            stopService(new Intent(this, MediaSessionService.class));
        }
        super.onDestroy();
    }
}
