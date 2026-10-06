// The visitor's Anthropic API key, if they choose to keep it. It lives in this browser's storage
// and nowhere else: it is not part of a design, so it is never in a link, an export or an embed,
// and the only request that carries it goes to api.anthropic.com.

const STORAGE_KEY = 'loadline:anthropic-key:v1';

export function readKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Keeps the key for next time, or with an empty key, forgets it. */
export function keepKey(key: string): void {
  try {
    if (key === '') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Without storage the key lasts as long as the dialog is open, which is the safer failure.
  }
}
