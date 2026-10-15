import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { pipeChatPdf } from '../lib/chatpdf.js';
import { extractPdf } from '../lib/extract.js';

function render(input) {
  return new Promise((resolve, reject) => {
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    pipeChatPdf(out, input);
  });
}

test('chat PDF holds its title, summary, labels, attachments, prose and code', async () => {
  const pdf = await render({
    title: 'Parser',
    summary: 'Earlier we chose nom.',
    messages: [
      { role: 'user', content: 'Show a parser', attachments: [{ name: 'grammar.txt' }] },
      { role: 'assistant', content: 'Here it is.\n\n```rust\nfn main() {}\n```\n\nDone.' }
    ]
  });
  const raw = pdf.toString('latin1');
  assert.ok(raw.startsWith('%PDF-'));
  assert.ok(raw.trimEnd().endsWith('%%EOF'));
  assert.ok(raw.includes('+NotoSansMono'));
  const text = (await extractPdf(pdf)).replace(/\s+/g, ' ');
  for (const part of ['Parser', 'Exported', 'Summary of earlier conversation', 'Earlier we chose nom.', 'You', 'Assistant', 'grammar.txt', 'Show a parser', 'Here it is.', 'fn main() {}', 'Done.']) {
    assert.ok(text.includes(part), part);
  }
});

test('chat PDF keeps every script and emoji readable', async () => {
  const pdf = await render({
    title: 'Über 日本語',
    summary: '',
    messages: [{ role: 'user', content: 'Привет 你好 ひらがな 한국어 café → ✓ 🙂 👍🏽' }]
  });
  const text = (await extractPdf(pdf)).replace(/\s+/g, ' ');
  for (const part of ['Über', '日本語', 'Привет', '你好', 'ひらがな', '한국어', 'café', '→', '✓', '🙂', '👍']) {
    assert.ok(text.includes(part), part);
  }
  assert.ok(!text.includes('🏽'));
});

test('chat PDF renders Markdown without its markup', async () => {
  const pdf = await render({
    title: 'Notes',
    summary: '',
    messages: [{ role: 'assistant', content: '## Plan\n\n- **first** step\n- see [the docs](https://example.com)\n\n> quoted *aside*\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n---\n\nuse `npm test` and snake_case_name' }]
  });
  const text = (await extractPdf(pdf)).replace(/\s+/g, ' ');
  for (const part of ['Plan', 'first', 'step', 'the docs', 'quoted', 'aside', 'npm test', 'snake_case_name']) {
    assert.ok(text.includes(part), part);
  }
  for (const markup of ['##', '**', '](', '---', '`']) assert.ok(!text.includes(markup), markup);
  assert.ok(pdf.toString('latin1').includes('/URI (https://example.com)'));
});

test('chat PDF with no messages still renders a valid document', async () => {
  const raw = (await render({ title: '', summary: '', messages: [] })).toString('latin1');
  assert.ok(raw.startsWith('%PDF-'));
  assert.ok(raw.trimEnd().endsWith('%%EOF'));
  assert.ok(raw.includes('/Title '));
});