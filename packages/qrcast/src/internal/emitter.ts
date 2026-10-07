type Listener<T> = (payload: T) => void;

/**
 * A small typed event emitter. A listener that throws is reported with
 * `reportError` and does not stop delivery to the other listeners.
 */
export class Emitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Adds a listener; the returned function removes it. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    // A wrapper, so that adding the same function twice gives two listeners.
    const entry: Listener<Events[K]> = (payload) => listener(payload);
    set.add(entry as Listener<never>);
    return () => {
      set.delete(entry as Listener<never>);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        report(error);
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}

function report(error: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
  else console.error(error);
}
