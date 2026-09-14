const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');

function productionJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'tests' ? [] : productionJavaScriptFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

test('production JavaScript avoids nullish coalescing unsupported by preview upload', () => {
  const incompatible = productionJavaScriptFiles(projectRoot).filter((file) => {
    return fs.readFileSync(file, 'utf8').includes('??');
  });

  assert.deepEqual(
    incompatible.map((file) => path.relative(projectRoot, file)),
    []
  );
});
