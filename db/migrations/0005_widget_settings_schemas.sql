-- 0005: make the config schemas good enough to generate a settings form from.
--
-- The shell renders each widget's settings panel directly from
-- widget_types.config_schema — labels from `title`, help text from `description`,
-- a dropdown wherever there is an `enum`. So a widget author gets a settings UI
-- without writing one, and a third-party widget cannot ship a settings form that
-- writes config its own schema forbids.
--
-- This is the payoff for the catalogue being a table: improving every Clock's
-- settings panel is an UPDATE.

update widget_types set config_schema = '{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "text": {
      "type": "string",
      "title": "Text",
      "description": "Edited in the widget itself, not here.",
      "maxLength": 10000,
      "default": ""
    }
  }
}'::jsonb
where type = 'notes';

update widget_types set config_schema = '{
  "type": "object",
  "additionalProperties": false,
  "required": ["timeZone"],
  "properties": {
    "timeZone": {
      "type": "string",
      "title": "Time zone",
      "description": "IANA zone name.",
      "default": "Europe/Amsterdam",
      "enum": [
        "Europe/Amsterdam",
        "Europe/London",
        "Europe/Berlin",
        "Europe/Lisbon",
        "America/New_York",
        "America/Los_Angeles",
        "Asia/Tokyo",
        "Asia/Shanghai",
        "Australia/Sydney",
        "UTC"
      ]
    },
    "showSeconds": {
      "type": "boolean",
      "title": "Show seconds",
      "default": true
    },
    "label": {
      "type": "string",
      "title": "Label",
      "description": "Shown above the time. Leave empty for none.",
      "maxLength": 40,
      "default": ""
    }
  }
}'::jsonb
where type = 'clock';

update widget_types set config_schema = '{
  "type": "object",
  "additionalProperties": false,
  "required": ["count"],
  "properties": {
    "label": {
      "type": "string",
      "title": "Label",
      "maxLength": 60,
      "default": "Count"
    },
    "count": {
      "type": "integer",
      "title": "Current value",
      "description": "Also changed by the buttons on the widget.",
      "default": 0
    },
    "step": {
      "type": "integer",
      "title": "Step",
      "description": "How much each button press adds or subtracts.",
      "minimum": 1,
      "maximum": 1000,
      "default": 1
    }
  }
}'::jsonb
where type = 'counter';

-- The schemas changed shape (clock gained a label, counter gained a step), so
-- the version moves with them. The API caches compiled validators per
-- type@version, and the client will refetch on the next load.
update widget_types set version = '1.1.0' where type in ('notes', 'clock', 'counter');
