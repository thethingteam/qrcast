/** The bytes the codec had to send: the deflated size when that is smaller, as in the envelope. */
export async function wireSize(bytes: Uint8Array): Promise<number> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const deflated = (await new Response(stream).arrayBuffer()).byteLength;
  return Math.min(bytes.length, deflated);
}

export function formatRate(bytes: number, seconds: number): string {
  if (!(seconds > 0)) return '–';
  const rate = bytes / 1024 / seconds;
  return `${rate >= 100 ? rate.toFixed(0) : rate.toFixed(1)} KB/s`;
}

/** Seconds left at the current pace, or null while too little has arrived to tell. */
export function secondsLeft(progress: number, elapsed: number): number | null {
  if (progress < 0.05 || progress >= 1 || elapsed <= 0) return null;
  return (elapsed * (1 - progress)) / progress;
}
