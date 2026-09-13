function createRequestJson(wxApi) {
  return function requestJson({ url, timeout = 8000 }) {
    return new Promise((resolve, reject) => wxApi.request({
      url,
      timeout,
      success(response) {
        if (response.statusCode === 404) return reject(Object.assign(new Error('未找到单词'), { code: 'NOT_FOUND' }));
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(Object.assign(new Error('词典服务暂时不可用'), { code: 'HTTP_ERROR' }));
        resolve(response.data);
      },
      fail(error) {
        const message = String(error && error.errMsg || '');
        const code = /domain list/i.test(message) ? 'DOMAIN_NOT_ALLOWED' : /timeout/i.test(message) ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR';
        reject(Object.assign(new Error(message), { code }));
      }
    }));
  };
}

module.exports = { createRequestJson };
