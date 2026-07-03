const AUTH_TOKEN_KEY = "building-exterior-access-token";

function getLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getAuthToken() {
  return getLocalStorage()?.getItem(AUTH_TOKEN_KEY) ?? null;
}

export function setAuthToken(token: string) {
  getLocalStorage()?.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  getLocalStorage()?.removeItem(AUTH_TOKEN_KEY);
}
