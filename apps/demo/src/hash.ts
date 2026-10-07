/** The SHA-256 of `bytes` as lowercase hex. Needs a secure context in browsers. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The first 8 hex digits of the SHA-256, short enough to compare by eye. */
export async function shortHash(bytes: Uint8Array): Promise<string> {
  return (await sha256(bytes)).slice(0, 8);
}
