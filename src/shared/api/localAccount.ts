// no-account mode: the app runs with no liner server at all. music comes from the
// client-side catalog, while likes, playlists, saved collections and history live
// on the device (see localBackend.ts). this module is only the on/off flag and the
// stand-in session, so it has no dependencies and anything can import it.
import type { AuthTokens, AuthUser } from "../contracts";

const FLAG_KEY = "liner_local_account";
const USER_KEY = "liner_local_account_user";

const DEFAULT_USER: AuthUser = {
  id: "local",
  username: "this-device",
  displayName: "This device",
};

export function isLocalAccount(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function enterLocalAccount(): void {
  localStorage.setItem(FLAG_KEY, "1");
}

// signing out only leaves the mode: the library stays on the device for next time
export function leaveLocalAccount(): void {
  localStorage.removeItem(FLAG_KEY);
}

export function localUser(): AuthUser {
  try {
    const stored = localStorage.getItem(USER_KEY);
    if (stored) return { ...DEFAULT_USER, ...(JSON.parse(stored) as AuthUser), id: DEFAULT_USER.id };
  } catch {
    // unreadable: fall back to the default name
  }
  return DEFAULT_USER;
}

export function saveLocalUser(user: AuthUser): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // storage full: the name just won't survive a restart
  }
}

// every "is someone signed in" check in the app keeps working against this. the
// far-off expiry means nothing ever tries to refresh it
export function localSession(): AuthTokens {
  return {
    accessToken: "local",
    refreshToken: "",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    user: localUser(),
  };
}
