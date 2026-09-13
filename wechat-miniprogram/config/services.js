const SERVICES = {
  dictionary: 'https://freedictionaryapi.com/api/v1/entries/en/',
  translation: 'https://api.mymemory.translated.net/get',
  americanTts: 'https://dict.youdao.com/dictvoice?type=2&audio='
};

function dictionaryUrl(word) {
  return `${SERVICES.dictionary}${encodeURIComponent(word)}?translations=true`;
}

function translationUrl(word) {
  return `${SERVICES.translation}?q=${encodeURIComponent(word)}&langpair=en%7Czh-CN`;
}

function americanTtsUrl(word) {
  return `${SERVICES.americanTts}${encodeURIComponent(word)}`;
}

module.exports = { SERVICES, dictionaryUrl, translationUrl, americanTtsUrl };
