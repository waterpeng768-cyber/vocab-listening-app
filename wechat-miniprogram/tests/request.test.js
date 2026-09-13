const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequestJson } = require('../services/request');

test('returns successful JSON response data', async () => {
  const requestJson = createRequestJson({
    request(options) {
      options.success({ statusCode: 200, data: { code: 'OK' } });
    }
  });

  const result = await requestJson({ url: 'https://dictionary.example/tool' });

  assert.equal(result.code, 'OK');
});

test('maps WeChat timeout failures to NETWORK_TIMEOUT', async () => {
  const requestJson = createRequestJson({
    request(options) {
      options.fail({ errMsg: 'request:fail timeout' });
    }
  });

  await assert.rejects(
    requestJson({ url: 'https://dictionary.example/tool' }),
    (error) => error.code === 'NETWORK_TIMEOUT'
  );
});

test('maps HTTP 404 responses to NOT_FOUND', async () => {
  const requestJson = createRequestJson({
    request(options) {
      options.success({ statusCode: 404, data: {} });
    }
  });

  await assert.rejects(
    requestJson({ url: 'https://dictionary.example/missing' }),
    (error) => error.code === 'NOT_FOUND'
  );
});

test('maps WeChat domain-list failures to DOMAIN_NOT_ALLOWED', async () => {
  const requestJson = createRequestJson({
    request(options) {
      options.fail({ errMsg: 'request:fail url not in domain list' });
    }
  });

  await assert.rejects(
    requestJson({ url: 'https://dictionary.example/tool' }),
    (error) => error.code === 'DOMAIN_NOT_ALLOWED'
  );
});
