import { describe, it } from 'node:test';
import assert from 'node:assert';
import { escapeXML, wrapInXML, buildTaskXML } from '../src/harvested/gsd/xml-utils.js';

describe('escapeXML', () => {
  it('escapes ampersands', () => {
    assert.strictEqual(escapeXML('a&b'), 'a&amp;b');
  });

  it('escapes angle brackets', () => {
    assert.strictEqual(escapeXML('<script>'), '&lt;script&gt;');
  });

  it('escapes quotes', () => {
    assert.strictEqual(escapeXML('"hello" & \'world\''), '&quot;hello&quot; &amp; &apos;world&apos;');
  });

  it('leaves clean strings unchanged', () => {
    assert.strictEqual(escapeXML('hello world'), 'hello world');
  });

  it('handles empty string', () => {
    assert.strictEqual(escapeXML(''), '');
  });
});

describe('wrapInXML', () => {
  it('wraps content in tags with escaping', () => {
    assert.strictEqual(wrapInXML('name', 'test<value>'), '<name>test&lt;value&gt;</name>');
  });
});

describe('buildTaskXML', () => {
  it('produces valid XML for a simple task', () => {
    const xml = buildTaskXML({ name: 'Build feature' });
    assert.ok(xml.includes('<task type="auto">'));
    assert.ok(xml.includes('<name>Build feature</name>'));
    assert.ok(xml.includes('</task>'));
  });

  it('escapes special characters in task name', () => {
    const xml = buildTaskXML({ name: 'Fix <script> & "injection"' });
    assert.ok(xml.includes('&lt;script&gt;'));
    assert.ok(xml.includes('&amp;'));
    assert.ok(xml.includes('&quot;injection&quot;'));
    assert.ok(!xml.includes('<script>'));
  });

  it('escapes file paths', () => {
    const xml = buildTaskXML({ name: 'test', files: ['src/<main>.ts'] });
    assert.ok(xml.includes('src/&lt;main&gt;.ts'));
  });

  it('escapes verify criteria', () => {
    const xml = buildTaskXML({ name: 'test', verify: 'output > 0 & valid' });
    assert.ok(xml.includes('output &gt; 0 &amp; valid'));
  });

  it('omits optional fields when not provided', () => {
    const xml = buildTaskXML({ name: 'test' });
    assert.ok(!xml.includes('<files>'));
    assert.ok(!xml.includes('<verify>'));
  });
});
