import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatToolAsXml, formatToolsAsXml } from '../src/utils/toolsXmlFormatter.js';

const CRON_CREATE_TOOL = {
  name: 'CronCreate',
  description: 'Schedule a prompt to be enqueued at a future time.',
  input_schema: {
    type: 'object',
    properties: {
      cron: { type: 'string', description: '5-field cron expression' },
      prompt: { type: 'string', description: 'The prompt to enqueue' },
      recurring: { type: 'boolean', description: 'Fire repeatedly', default: true },
      durable: { type: 'boolean', description: 'Persist to disk' },
    },
    required: ['cron', 'prompt'],
    additionalProperties: false,
  },
};

describe('formatToolAsXml', () => {
  it('wraps tool metadata in <tool> with name + description + parameters', () => {
    const xml = formatToolAsXml(CRON_CREATE_TOOL);
    assert.match(xml, /^<tool>\n/);
    assert.match(xml, /\n<\/tool>$/);
    assert.match(xml, /<name>CronCreate<\/name>/);
    assert.match(xml, /<description>Schedule a prompt to be enqueued at a future time\.<\/description>/);
  });

  it('emits one <parameter> per schema property with correct required flag', () => {
    const xml = formatToolAsXml(CRON_CREATE_TOOL);
    const paramMatches = xml.match(/<parameter>/g) || [];
    assert.equal(paramMatches.length, 4);
    // required ones
    assert.match(xml, /<name>cron<\/name>\n\s*<type>string<\/type>\n\s*<description>5-field cron expression<\/description>\n\s*<required>true<\/required>/);
    assert.match(xml, /<name>prompt<\/name>\n\s*<type>string<\/type>\n\s*<description>The prompt to enqueue<\/description>\n\s*<required>true<\/required>/);
    // optional ones
    assert.match(xml, /<name>recurring<\/name>\n\s*<type>boolean<\/type>\n\s*<description>Fire repeatedly<\/description>\n\s*<required>false<\/required>/);
    assert.match(xml, /<name>durable<\/name>\n\s*<type>boolean<\/type>\n\s*<description>Persist to disk<\/description>\n\s*<required>false<\/required>/);
  });

  it('serializes default values via <default>', () => {
    const xml = formatToolAsXml(CRON_CREATE_TOOL);
    assert.match(xml, /<default>true<\/default>/);
  });

  it('handles enum parameters with <enum>', () => {
    const tool = {
      name: 'SetMode',
      description: 'Pick a mode',
      input_schema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['fast', 'careful', 'auto'], description: 'Mode' },
        },
        required: ['mode'],
      },
    };
    const xml = formatToolAsXml(tool);
    assert.match(xml, /<enum>fast, careful, auto<\/enum>/);
  });

  it('serializes array parameters with <items>', () => {
    const tool = {
      name: 'Send',
      description: 'Send tags',
      input_schema: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' }, description: 'List of tags' },
        },
        required: ['tags'],
      },
    };
    const xml = formatToolAsXml(tool);
    assert.match(xml, /<type>array<\/type>/);
    assert.match(xml, /<items>\{"type":"string"\}<\/items>/);
  });

  it('serializes object parameters with <properties>', () => {
    const tool = {
      name: 'Configure',
      description: 'Configure options',
      input_schema: {
        type: 'object',
        properties: {
          opts: {
            type: 'object',
            properties: { k: { type: 'string' } },
            description: 'Options bag',
          },
        },
      },
    };
    const xml = formatToolAsXml(tool);
    assert.match(xml, /<type>object<\/type>/);
    assert.match(xml, /<properties>\{"k":\{"type":"string"\}\}<\/properties>/);
  });

  it('emits empty <parameters></parameters> for tool with no properties', () => {
    const tool = {
      name: 'Ping',
      description: 'Pings the server',
      input_schema: { type: 'object', properties: {} },
    };
    const xml = formatToolAsXml(tool);
    assert.match(xml, /<parameters><\/parameters>/);
  });

  it('falls back gracefully for missing fields', () => {
    assert.equal(formatToolAsXml(null), '');
    assert.equal(formatToolAsXml(undefined), '');
    const xml = formatToolAsXml({});
    assert.match(xml, /<name>unknown<\/name>/);
    assert.match(xml, /<description><\/description>/);
  });

  it('accepts legacy "parameters" key when input_schema missing', () => {
    const tool = {
      name: 'Legacy',
      description: 'Old-style tool',
      parameters: {
        type: 'object',
        properties: { x: { type: 'integer', description: 'count' } },
        required: ['x'],
      },
    };
    const xml = formatToolAsXml(tool);
    assert.match(xml, /<name>x<\/name>/);
    assert.match(xml, /<type>integer<\/type>/);
    assert.match(xml, /<required>true<\/required>/);
  });
});

describe('formatToolAsXml — raw text passthrough', () => {
  it('keeps < > & in description as-is (no XML escape)', () => {
    const tool = {
      name: 'Compare',
      description: 'Returns true when x < y && x > 0',
      input_schema: { type: 'object', properties: {} },
    };
    const xml = formatToolAsXml(tool);
    assert.match(xml, /<description>Returns true when x < y && x > 0<\/description>/);
    assert.ok(!xml.includes('&lt;'), 'should not escape');
    assert.ok(!xml.includes('&amp;'), 'should not escape');
  });

  it('keeps quotes and apostrophes in description as-is', () => {
    const tool = {
      name: 'Quote',
      description: 'has "quotes" and \'apostrophes\'',
      input_schema: { type: 'object', properties: {} },
    };
    const xml = formatToolAsXml(tool);
    assert.match(xml, /<description>has "quotes" and 'apostrophes'<\/description>/);
  });

  it('first-match parser semantics: tool-level <name> resolved correctly even when description embeds literal <name>...</name>', () => {
    // Even without escape, parseCachedTools' non-greedy /<name>([\s\S]*?)<\/name>/
    // must pick the tool-level name, because <name> appears before <description>
    // in the output structure.
    const tool = {
      name: 'RealName',
      description: 'See also <name>FakeName</name> for context',
      input_schema: { type: 'object', properties: {} },
    };
    const xml = formatToolAsXml(tool);
    // The fake <name> stays raw in the output — that is intentional.
    assert.ok(xml.includes('<name>FakeName</name>'), 'fake name preserved as raw text');
    // But first-match still picks the tool-level RealName.
    const firstNameMatch = xml.match(/<name>([\s\S]*?)<\/name>/);
    assert.equal(firstNameMatch[1], 'RealName');
  });
});

describe('formatToolsAsXml', () => {
  it('wraps multiple tools in a single <tools> block', () => {
    const xml = formatToolsAsXml([
      CRON_CREATE_TOOL,
      { name: 'Noop', description: 'Does nothing', input_schema: { type: 'object', properties: {} } },
    ]);
    assert.match(xml, /^<tools>\n/);
    assert.match(xml, /\n<\/tools>$/);
    const toolMatches = xml.match(/<tool>/g) || [];
    assert.equal(toolMatches.length, 2);
    assert.match(xml, /<name>CronCreate<\/name>/);
    assert.match(xml, /<name>Noop<\/name>/);
  });

  it('returns empty <tools></tools> for empty / invalid input', () => {
    assert.equal(formatToolsAsXml([]), '<tools></tools>');
    assert.equal(formatToolsAsXml(null), '<tools></tools>');
    assert.equal(formatToolsAsXml(undefined), '<tools></tools>');
  });
});
