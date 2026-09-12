const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageDirectory = path.join(__dirname, '..', 'pages', 'index');

test('binds every required vocabulary and review action', () => {
  const script = fs.readFileSync(path.join(pageDirectory, 'index.js'), 'utf8');
  const template = fs.readFileSync(path.join(pageDirectory, 'index.wxml'), 'utf8');
  const handlers = [
    'switchTab', 'onLookup', 'onSave', 'onEdit', 'onDelete', 'onPlay',
    'onReveal', 'onNext', 'onModeChange', 'onRateChange', 'onCopyBackup',
    'onImportBackup', 'onClearAll', 'onPlayWord'
  ];

  for (const handler of handlers) {
    assert.match(script, new RegExp(`\\b${handler}\\s*\\(`), `${handler} must be implemented`);
    assert.match(template, new RegExp(`bindtap="${handler}"`), `${handler} must be bound`);
  }
});

test('keeps answer IPA left-to-right and provides manual lookup fallback', () => {
  const template = fs.readFileSync(path.join(pageDirectory, 'index.wxml'), 'utf8');

  assert.match(template, /class="phonetic"[^>]*direction:ltr/);
  assert.match(template, /查询失败[^<]*手动填写/);
  assert.match(template, /class="status-text library-playback-status"/);
});
