// The wire shape of the per-pane PTY channel (`Channel<PtyEvent>`, internally
// tagged on `event`) and the decoder for its output frames.
//
//   { event: 'data', b64: string }  -> raw output bytes, standard base64
//   { event: 'exit', code: number } -> child exited and was reaped
//
// Output bytes travel as base64 rather than a JSON array of numbers: Tauri embeds
// each channel message in a script it evals in the webview, so a number array
// costs ~3.7 characters per byte to serialize, ship, and parse, against 1.33 for
// base64 — the hot path when several agents stream at once.

export type PtyEvent = { event: 'data'; b64: string } | { event: 'exit'; code: number };

/** Decode one output frame to the raw bytes xterm consumes. Malformed input
 *  yields an empty frame rather than throwing into the channel handler. */
export function decodePtyBytes(b64: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
