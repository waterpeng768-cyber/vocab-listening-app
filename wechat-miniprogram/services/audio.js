function createAudioPlayer(wxApi) {
  if (typeof wxApi.setInnerAudioOption === 'function') {
    wxApi.setInnerAudioOption({ obeyMuteSwitch: false });
  }
  const context = wxApi.createInnerAudioContext();
  context.obeyMuteSwitch = false;
  let activePlayback = null;

  function prepareAudioFile(tempFilePath, onReady, onFailure) {
    if (/\.(mp3|m4a|aac|wav)(?:$|[?#])/i.test(tempFilePath)) {
      onReady(tempFilePath);
      return;
    }
    if (!wxApi.env || !wxApi.env.USER_DATA_PATH || typeof wxApi.getFileSystemManager !== 'function') {
      onReady(tempFilePath);
      return;
    }

    const destination = `${wxApi.env.USER_DATA_PATH}/vocab-pronunciation.mp3`;
    const fileSystem = wxApi.getFileSystemManager();
    fileSystem.copyFile({
      srcPath: tempFilePath,
      destPath: destination,
      success() { onReady(destination); },
      fail() { onFailure('音频文件准备失败，请重试'); }
    });
  }

  function cancelActive(message) {
    if (!activePlayback) return;
    const playback = activePlayback;
    activePlayback = null;
    playback.cleanup();
    const error = new Error(message);
    error.code = 'PLAYBACK_CANCELLED';
    playback.reject(error);
  }

  function play(url, rate = 1) {
    cancelActive('已切换到新的单词');
    context.stop();
    if (!url) return Promise.reject(new Error('没有可用的美音音频'));

    return new Promise((resolve, reject) => {
      let downloadTask = null;
      let playback = null;
      const cleanup = () => {
        context.offEnded(onEnded);
        context.offError(onError);
      };
      const onEnded = () => {
        activePlayback = null;
        cleanup();
        resolve();
      };
      const fail = (message) => {
        if (activePlayback !== playback) return;
        activePlayback = null;
        cleanup();
        reject(new Error(message));
      };
      const onError = (detail) => {
        const code = detail && detail.errCode;
        const codeText = code === undefined || code === null ? '' : `（错误码 ${code}）`;
        fail(`美音播放失败${codeText}，请检查网络后重试`);
      };
      const startPlayback = (source) => {
        if (activePlayback !== playback) return;
        context.src = source;
        context.playbackRate = rate;
        try {
          context.play();
        } catch (_) {
          onError();
        }
      };

      playback = {
        cleanup() {
          cleanup();
          if (downloadTask && typeof downloadTask.abort === 'function') downloadTask.abort();
        },
        reject
      };
      activePlayback = playback;
      context.onEnded(onEnded);
      context.onError(onError);

      if (typeof wxApi.downloadFile !== 'function') {
        startPlayback(url);
        return;
      }

      downloadTask = wxApi.downloadFile({
        url,
        timeout: 15000,
        success(result) {
          const statusCode = Number(result && result.statusCode);
          const tempFilePath = result && result.tempFilePath;
          if (statusCode >= 200 && statusCode < 300 && tempFilePath) {
            prepareAudioFile(tempFilePath, startPlayback, fail);
            return;
          }
          fail('美音下载失败，请检查网络后重试');
        },
        fail() {
          fail('美音下载失败，请确认手机已开启开发调试');
        }
      });
    });
  }

  return {
    play,
    stop() {
      cancelActive('播放已停止');
      context.stop();
    },
    destroy() {
      cancelActive('播放已停止');
      context.destroy();
    }
  };
}

module.exports = { createAudioPlayer };
