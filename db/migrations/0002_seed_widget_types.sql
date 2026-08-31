-- 0002: the first-party widget catalogue.
--
-- These three exist to exercise the whole path — pick a widget, place it, resize
-- it, change its settings, reload — not because blue door needs a clock. Replace
-- them with real ones; the point is that adding a widget type is an INSERT here
-- plus a component registered under the same `type` in web/src/widgets/registry.ts.
--
-- entry_url is NULL for all three: first-party components resolved from the
-- frontend registry. It becomes a URL when widgets are loaded into a sandbox.

insert into widget_types (type, version, display_name, description, config_schema, default_w, default_h, min_w, min_h)
values
  (
    'notes',
    '1.0.0',
    'Notes',
    'A free-text scratchpad. Saves through the host, so it demonstrates persisted widget config.',
    '{
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "text": { "type": "string", "maxLength": 10000, "default": "" }
      }
    }'::jsonb,
    4, 4, 2, 2
  ),
  (
    'clock',
    '1.0.0',
    'Clock',
    'Current time in a chosen IANA timezone. Read-only config, set from the widget settings panel.',
    '{
      "type": "object",
      "additionalProperties": false,
      "required": ["timeZone"],
      "properties": {
        "timeZone": { "type": "string", "default": "Europe/Amsterdam" },
        "showSeconds": { "type": "boolean", "default": true }
      }
    }'::jsonb,
    3, 2, 2, 2
  ),
  (
    'counter',
    '1.0.0',
    'Counter',
    'A tally with plus/minus buttons. Every click round-trips through the API to Postgres.',
    '{
      "type": "object",
      "additionalProperties": false,
      "required": ["count"],
      "properties": {
        "count": { "type": "integer", "default": 0 },
        "label": { "type": "string", "maxLength": 60, "default": "Count" }
      }
    }'::jsonb,
    3, 2, 2, 2
  )
on conflict (type) do nothing;
