import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.hkamori.liner",
  appName: "Liner",
  webDir: "dist",
  android: {
    // keep webview debuggable via chrome://inspect in debug builds
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    // electron runs with webSecurity off + injected cors headers; on android
    // the native http stack (and its same-origin proxy) stands in for that.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
