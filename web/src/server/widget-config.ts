import Ajv, { type ValidateFunction } from "ajv";

// One validator definition, not two: the JSON Schema in widget_types.config_schema
// is compiled here, and the same column feeds the settings UI. A widget type
// changes its config shape in one place — the database.
const ajv = new Ajv({
  allErrors: true,
  useDefaults: true,
  // Widget schemas are authored data, not code. Don't reject them over strict-mode
  // keyword rules the author had no way to know about.
  strict: false,
});

const cache = new Map<string, ValidateFunction>();

export type ConfigValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: string[] };

export function validateWidgetConfig(
  widgetType: string,
  typeVersion: string,
  configSchema: unknown,
  config: unknown,
): ConfigValidation {
  // Keyed by version so bumping a widget type's version recompiles rather than
  // serving a stale validator out of a warm process.
  const key = `${widgetType}@${typeVersion}`;

  let validate = cache.get(key);
  if (!validate) {
    try {
      validate = ajv.compile(configSchema as object);
    } catch (error) {
      return { ok: false, errors: [`widget type ${key} has an invalid config_schema: ${String(error)}`] };
    }
    cache.set(key, validate);
  }

  // useDefaults mutates, so validate a copy and hand back the filled-in result.
  const candidate = structuredClone(config ?? {});
  if (!validate(candidate)) {
    return {
      ok: false,
      errors: (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`),
    };
  }

  return { ok: true, value: candidate as Record<string, unknown> };
}
