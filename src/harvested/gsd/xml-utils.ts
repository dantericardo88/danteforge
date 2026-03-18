// XML utilities — structured prompt formatting for LLM task execution

export function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function wrapInXML(tag: string, content: string): string {
  return `<${tag}>${escapeXML(content)}</${tag}>`;
}

export function buildTaskXML(task: { name: string; files?: string[]; verify?: string }): string {
  const lines = [
    '<task type="auto">',
    `  <name>${escapeXML(task.name)}</name>`,
  ];
  if (task.files) {
    lines.push(`  <files>${task.files.map(f => escapeXML(f)).join(', ')}</files>`);
  }
  if (task.verify) {
    lines.push(`  <verify>${escapeXML(task.verify)}</verify>`);
  }
  lines.push('</task>');
  return lines.join('\n');
}
