/**
 * Serialize an Anthropic tool definition (name / description / input_schema)
 * into the XML-shaped text format the model sees on the server side.
 *
 * Based on the Claude 2.1 tool-use reference format. Claude 3/4 do not
 * publish their exact internal serialization, so this is a faithful
 * approximation useful for inspection, not a canonical wire format.
 */

function indentLines(text, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

function formatParameter(name, schema, required) {
  const s = schema && typeof schema === 'object' ? schema : {};
  const type = s.type || (Array.isArray(s.enum) ? 'enum' : 'any');
  const desc = typeof s.description === 'string' ? s.description : '';

  const lines = [
    '<parameter>',
    `  <name>${name}</name>`,
    `  <type>${type}</type>`,
  ];
  if (desc) {
    lines.push(`  <description>${desc}</description>`);
  }
  lines.push(`  <required>${required ? 'true' : 'false'}</required>`);

  if (Array.isArray(s.enum) && s.enum.length > 0) {
    lines.push(`  <enum>${s.enum.map((v) => String(v)).join(', ')}</enum>`);
  }
  if (s.default !== undefined) {
    lines.push(`  <default>${JSON.stringify(s.default)}</default>`);
  }
  if (type === 'array' && s.items) {
    lines.push(`  <items>${JSON.stringify(s.items)}</items>`);
  }
  if (type === 'object' && s.properties) {
    lines.push(`  <properties>${JSON.stringify(s.properties)}</properties>`);
  }

  lines.push('</parameter>');
  return lines.join('\n');
}

export function formatToolAsXml(tool) {
  if (!tool || typeof tool !== 'object') return '';
  const name = tool.name || 'unknown';
  const description = typeof tool.description === 'string' ? tool.description : '';
  const schema = tool.input_schema || tool.parameters || {};
  const properties =
    schema && typeof schema === 'object' && schema.properties ? schema.properties : {};
  const requiredSet = new Set(
    Array.isArray(schema && schema.required) ? schema.required : []
  );

  const paramXmls = Object.entries(properties).map(([paramName, paramSchema]) =>
    formatParameter(paramName, paramSchema, requiredSet.has(paramName))
  );

  const parametersBlock =
    paramXmls.length > 0
      ? '<parameters>\n' + indentLines(paramXmls.join('\n')) + '\n</parameters>'
      : '<parameters></parameters>';

  const body = [
    `<name>${name}</name>`,
    `<description>${description}</description>`,
    parametersBlock,
  ].join('\n');

  return '<tool>\n' + indentLines(body) + '\n</tool>';
}

export function formatToolsAsXml(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return '<tools></tools>';
  const body = tools.map(formatToolAsXml).join('\n');
  return '<tools>\n' + indentLines(body) + '\n</tools>';
}
