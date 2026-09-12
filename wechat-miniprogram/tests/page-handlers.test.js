const test = require('node:test');
const assert = require('node:assert/strict');

function loadPageDefinition() {
  let definition;
  const previousPage = global.Page;
  global.Page = (value) => { definition = value; };
  const modulePath = require.resolve('../pages/index/index');
  delete require.cache[modulePath];
  require(modulePath);
  global.Page = previousPage;
  return definition;
}

function pageHarness(overrides = {}) {
  const definition = loadPageDefinition();
  const page = {
    ...definition,
    data: {
      ...definition.data,
      draft: { ...definition.data.draft },
      words: [],
      ...overrides.data
    },
    setData(patch) { this.data = { ...this.data, ...patch }; },
    controller: overrides.controller
  };
  return page;
}

test('lookup passes the complete editing draft so its id is retained', async () => {
  const calls = [];
  const draft = { id: 'word-1', word: 'instrument', meaning: '工具' };
  const page = pageHarness({
    data: { draft },
    controller: { lookupDraft: async (...args) => calls.push(args) }
  });

  await page.onLookup();

  assert.deepEqual(calls, [['instrument', draft]]);
});

test('invalid input stops lookup and shows actionable Chinese feedback', async (t) => {
  const calls = [];
  const previousWx = global.wx;
  t.after(() => { global.wx = previousWx; });
  global.wx = { showToast: (options) => calls.push(options) };
  const page = pageHarness({
    data: { draft: { word: 'tool2' } },
    controller: { lookupDraft: async () => assert.fail('lookup must not run') }
  });

  await page.onLookup();

  assert.match(calls[0].title, /只支持英文字母/);
});

test('invalid input stops save before controller persistence', (t) => {
  const calls = [];
  const previousWx = global.wx;
  t.after(() => { global.wx = previousWx; });
  global.wx = { showToast: (options) => calls.push(options) };
  const page = pageHarness({
    data: { draft: { word: 'tool--box' } },
    controller: { saveDraft: () => assert.fail('save must not run') }
  });

  page.onSave();

  assert.match(calls[0].title, /连字符或撇号/);
});

test('next handler delegates selection to the controller', () => {
  let moveCalls = 0;
  const page = pageHarness({
    controller: { moveNext: () => { moveCalls += 1; } }
  });

  page.onNext();

  assert.equal(moveCalls, 1);
});

test('row play handler requests audio for that vocabulary id', async () => {
  const calls = [];
  const page = pageHarness({
    controller: { playWord: async (id) => calls.push(id) }
  });

  await page.onPlayWord({ currentTarget: { dataset: { id: 'word-2' } } });

  assert.deepEqual(calls, ['word-2']);
});
