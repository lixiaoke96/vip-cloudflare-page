(function () {
  'use strict';

  // ===== DOM 元素 =====
  const videoUrlInput = document.getElementById('videoUrl');
  const apiSelect = document.getElementById('apiSelect');
  const parseBtn = document.getElementById('parseBtn');
  const statusMsg = document.getElementById('statusMsg');
  const playerWrapper = document.getElementById('playerWrapper');
  const tips = document.getElementById('tips');
  const btnText = parseBtn.querySelector('.btn-text');
  const btnLoading = parseBtn.querySelector('.btn-loading');

  // ===== 状态 =====
  let art = null;           // ArtPlayer 实例
  let apiConfig = [];       // API 配置列表

  // ===== 初始化 =====
  async function init() {
    await loadConfig();
    bindEvents();
  }

  // ===== 加载配置文件 =====
  async function loadConfig() {
    try {
      const response = await fetch('config.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const config = await response.json();
      apiConfig = config.apis || [];

      // 填充下拉框
      apiSelect.innerHTML = '';
      if (apiConfig.length === 0) {
        apiSelect.innerHTML = '<option value="">没有可用的解析接口</option>';
      } else {
        apiSelect.innerHTML = '<option value="">请选择解析接口...</option>';
        apiConfig.forEach((api, index) => {
          const option = document.createElement('option');
          option.value = index;
          option.textContent = api.name;
          apiSelect.appendChild(option);
        });
      }
    } catch (err) {
      console.error('加载配置文件失败:', err);
      apiSelect.innerHTML = '<option value="">加载接口列表失败，请检查 config.json</option>';
      showStatus('加载接口配置失败，请确保 config.json 文件存在且格式正确', 'error');
    }
  }

  // ===== 绑定事件 =====
  function bindEvents() {
    parseBtn.addEventListener('click', handleParse);

    // Enter 键提交
    videoUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleParse();
      }
    });
  }

  // ===== 处理解析 =====
  async function handleParse() {
    const videoUrl = videoUrlInput.value.trim();
    const apiIndex = apiSelect.value;

    // 验证输入
    if (!videoUrl) {
      showStatus('请先输入视频链接', 'error');
      videoUrlInput.focus();
      return;
    }

    if (!isValidUrl(videoUrl)) {
      showStatus('请输入有效的 URL 地址（以 http:// 或 https:// 开头）', 'error');
      return;
    }

    if (apiIndex === '') {
      showStatus('请先选择一个解析接口', 'error');
      return;
    }

    const api = apiConfig[parseInt(apiIndex, 10)];
    if (!api || !api.url) {
      showStatus('所选接口配置无效，请检查 config.json', 'error');
      return;
    }

    // 构建请求 URL
    const requestUrl = api.url.replace('{url}', encodeURIComponent(videoUrl));

    // 显示加载状态
    setLoading(true);
    hideStatus();
    hidePlayer();

    try {
      // 发起请求
      const response = await fetch(requestUrl, {
        method: 'GET',
        // 部分 API 可能需要设置 referer
      });

      if (!response.ok) {
        throw new Error(`接口返回 HTTP ${response.status}`);
      }

      // 尝试解析响应
      const videoSrc = await extractVideoUrl(response, requestUrl);

      if (!videoSrc) {
        throw new Error('无法从接口响应中提取视频地址');
      }

      // 播放视频
      showStatus('解析成功，正在加载视频...', 'success');
      initPlayer(videoSrc);
      playerWrapper.style.display = 'block';
      tips.style.display = 'none';

      // 滚动到播放器
      playerWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });

    } catch (err) {
      console.error('视频解析失败:', err);
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        showStatus('网络请求失败，接口可能不可用或存在跨域限制，请尝试其他接口', 'error');
      } else {
        showStatus(`解析失败：${err.message}`, 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  // ===== 从响应中提取视频地址 =====
  async function extractVideoUrl(response, requestUrl) {
    const contentType = response.headers.get('content-type') || '';

    // 如果返回的是重定向后的 URL（fetch 自动跟随重定向）
    const finalUrl = response.url;

    // 如果最终 URL 和请求 URL 不同，说明发生了重定向，可能是视频地址
    if (finalUrl !== requestUrl) {
      // 检查是否是视频文件
      if (isVideoUrl(finalUrl)) {
        return finalUrl;
      }
    }

    // 尝试解析 JSON
    if (contentType.includes('application/json') || contentType.includes('text/')) {
      const text = await response.text();

      // 先尝试作为 JSON 解析
      try {
        const json = JSON.parse(text);
        // 多种可能的 JSON 结构
        const url = json.url || json.video || json.video_url || json.src ||
                    (json.data && (json.data.url || json.data.video || json.data.src)) ||
                    (json.result && (json.result.url || json.result.video || json.result.src));
        if (url && typeof url === 'string') {
          return url;
        }
      } catch (e) {
        // 不是 JSON，可能是纯文本 URL
        const trimmed = text.trim();
        if (isVideoUrl(trimmed) || trimmed.startsWith('http')) {
          return trimmed;
        }
      }
    }

    // 检查最终 URL 是否就是视频
    if (isVideoUrl(finalUrl)) {
      return finalUrl;
    }

    return null;
  }

  // ===== 判断是否为视频 URL =====
  function isVideoUrl(url) {
    if (!url) return false;
    const videoExts = ['.mp4', '.m3u8', '.flv', '.webm', '.mkv', '.avi', '.ts', '.mov'];
    const lower = url.toLowerCase().split('?')[0]; // 去除查询参数
    return videoExts.some(ext => lower.endsWith(ext));
  }

  // ===== 初始化/更新播放器 =====
  function initPlayer(videoSrc) {
    // 销毁旧播放器
    if (art) {
      art.destroy();
      art = null;
    }

    // 清空容器
    const container = document.getElementById('artplayer');
    container.innerHTML = '';

    // 判断视频类型
    const isHls = videoSrc.toLowerCase().includes('.m3u8');

    // 创建 ArtPlayer
    const playerOptions = {
      container: '#artplayer',
      url: videoSrc,
      autoplay: true,
      autoSize: true,
      autoMini: true,
      screenshot: true,
      hotkey: true,
      pip: true,
      mutex: true,
      fullscreen: true,
      fullscreenWeb: true,
      theme: '#6366f1',
      lang: 'zh-cn',
      moreVideoAttr: {
        crossOrigin: 'anonymous',
        playsInline: true,
        preload: 'auto',
      },
    };

    // HLS 流使用自定义播放器类型
    if (isHls && window.Hls && Hls.isSupported()) {
      playerOptions.customType = {
        m3u8: function (video, url) {
          const hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(video);
        },
      };
    }

    art = new Artplayer(playerOptions);

    // 监听错误
    art.on('error', (err) => {
      console.error('播放器错误:', err);
      showStatus('视频播放出错，可能是视频地址已失效或格式不支持', 'error');
    });

    art.on('ready', () => {
      console.log('播放器已就绪');
      hideStatus();
    });

    // 窗口大小变化时更新播放器
    art.on('resize', () => {
      // ArtPlayer 会自动处理
    });
  }

  // ===== UI 辅助函数 =====
  function setLoading(loading) {
    parseBtn.disabled = loading;
    btnText.style.display = loading ? 'none' : '';
    btnLoading.style.display = loading ? '' : 'none';
  }

  function showStatus(msg, type) {
    statusMsg.textContent = msg;
    statusMsg.className = `status-msg ${type}`;
    statusMsg.style.display = 'block';
  }

  function hideStatus() {
    statusMsg.style.display = 'none';
  }

  function hidePlayer() {
    playerWrapper.style.display = 'none';
    tips.style.display = '';
    if (art) {
      art.destroy();
      art = null;
    }
  }

  function isValidUrl(str) {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
