/**
 * The widget contract.
 *
 * A widget receives exactly two things: its own config, and a host object. It
 * imports nothing from the application, reads no globals, and has no database
 * handle. That is not fussiness — it is what lets these move into a sandboxed
 * iframe later without every widget being rewritten.
 *
 * Three rules keep that door open:
 *
 *  1. Every host method is async. postMessage cannot be synchronous, so a widget
 *     that reads state synchronously today breaks on the day it is sandboxed.
 *  2. Only structured-cloneable values cross this boundary. No React elements, no
 *     class instances, no callbacks passed as arguments — none of it survives
 *     serialisation.
 *  3. Nothing here exposes the host application. `query` names an operation the
 *     host decides how to answer; it is not a query language, and it is certainly
 *     not SQL.
 *
 * When widgets become third-party, the implementation behind this interface
 * changes from direct calls to postMessage RPC (Comlink, most likely). The
 * interface does not.
 */
export interface WidgetHost {
  /** This instance's id. Stable across reloads; useful as a cache key. */
  readonly instanceId: string;

  /** Persist this widget's settings. Validated server-side against the type's JSON Schema. */
  saveConfig(next: Record<string, unknown>): Promise<void>;

  /**
   * Ask the host for data by operation name. Unimplemented for now — it throws,
   * deliberately, rather than pretending. Widgets that need data will drive what
   * the first operations are.
   */
  query(operation: string, args?: unknown): Promise<unknown>;
}

export interface WidgetProps<TConfig = Record<string, unknown>> {
  config: TConfig;
  host: WidgetHost;
}
