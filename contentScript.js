(() => {
  const DOWNLOAD_BUTTON_ID = 'ytp-transcript-download-button';
  const PASTE_BUTTON_ID = 'ytp-transcript-paste-button';
  const TOAST_ID = 'ytp-transcript-download-toast';
  const MOMENTS_PANEL_ID = 'ytp-custom-moments-panel';
  const MOMENTS_MARKERS_ID = 'ytp-custom-moments-markers';
  const MOMENTS_BADGE_ID = 'ytp-custom-moments-badge';
  const ACTION_BUTTON_CLASS = 'ytp-button ytp-transcript-action-button';
  const TRANSCRIPT_PANEL_SELECTORS = [
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    '#panels ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
  ];
  const MOMENTS_STORAGE_PREFIX = 'ytp-custom-moments:';
  const MOMENT_ITEM_KEYS = ['moments', 'chapters', 'items', 'segments'];
  const MOMENTS_STORAGE_VERSION = 1;

  let lastVideoId = '';
  let ensureScheduled = false;
  let toastTimer = null;
  let boundVideoElement = null;
  let activeMoments = [];
  let activeMomentsVideoId = '';
  let activeMomentsLoadedVideoId = '';
  let momentsSyncRequestId = 0;

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function isWatchPage() {
    try {
      const url = new URL(window.location.href);
      return url.hostname.endsWith('youtube.com') && url.pathname === '/watch' && !!url.searchParams.get('v');
    } catch {
      return false;
    }
  }

  function getVideoId() {
    try {
      return new URL(window.location.href).searchParams.get('v') || '';
    } catch {
      return '';
    }
  }

  function getPlayerRoot() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function getVideoElement() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function getVideoDuration() {
    const video = getVideoElement();
    const duration = Number(video?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;

    try {
      const player = document.getElementById('movie_player');
      const fallback = Number(player?.getDuration?.());
      if (Number.isFinite(fallback) && fallback > 0) return fallback;
    } catch {}

    return 0;
  }

  function getVideoTitle() {
    try {
      const titleNode =
        document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
        document.querySelector('h1.title yt-formatted-string') ||
        document.querySelector('h1 yt-formatted-string');
      let title = (titleNode?.textContent || document.title || '').trim();
      title = title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
      return title || 'youtube-transcript';
    } catch {
      return 'youtube-transcript';
    }
  }

  function sanitizeFilename(value) {
    return (
      String(value || 'youtube-transcript')
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180) || 'youtube-transcript'
    );
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }

  function parseTimecode(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value >= 0 ? value : null;
    }

    const raw = String(value || '').trim();
    if (!raw) return null;

    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      const seconds = Number(raw);
      return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
    }

    const parts = raw.split(':').map((part) => Number(part.trim()));
    if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;

    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return null;
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, value));
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      const tick = () => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(null);
          return;
        }
        window.setTimeout(tick, 150);
      };

      tick();
    });
  }

  function safeClick(element) {
    if (!element) return false;
    try {
      element.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window
        })
      );
    } catch {}
    try {
      if (typeof element.click === 'function') {
        element.click();
        return true;
      }
    } catch {}
    return false;
  }

  function findTranscriptPanel() {
    for (const selector of TRANSCRIPT_PANEL_SELECTORS) {
      const panel = document.querySelector(selector);
      if (panel) return panel;
    }

    try {
      const list = document.querySelector('ytd-transcript-segment-list-renderer');
      const panel = list?.closest?.('ytd-engagement-panel-section-list-renderer');
      if (panel) return panel;
    } catch {}

    return null;
  }

  function isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (element.hasAttribute('hidden')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function closeYoutubeTranscriptPanelIfOpen() {
    const panel = findTranscriptPanel();
    if (!panel || !isElementVisible(panel)) return false;

    const closeControl = panel.querySelector(
      '#visibility-button > ytd-button-renderer > yt-button-shape > button, #visibility-button button'
    );
    if (closeControl) return safeClick(closeControl);

    const genericClose = panel.querySelector('button[aria-label*="Close"], button[aria-label*="close"]');
    return safeClick(genericClose);
  }

  async function dismissTranscriptPanelAfterCapture() {
    closeYoutubeTranscriptPanelIfOpen();
    await sleep(180);
    const panel = findTranscriptPanel();
    if (!panel) return;

    try {
      panel.style.opacity = '0';
      panel.style.pointerEvents = 'none';
    } catch {}
  }

  function reviveTranscriptPanel() {
    const panel = findTranscriptPanel();
    if (!panel) return false;

    try {
      panel.style.opacity = '';
      panel.style.pointerEvents = '';
      panel.style.display = '';
      panel.style.height = '';
      panel.style.maxHeight = '';
      panel.style.overflow = '';
    } catch {}
    return true;
  }

  function getPlayerResponse() {
    try {
      const direct = window.ytInitialPlayerResponse || window.ytInitialPlayerResponse_;
      if (direct) return direct;
    } catch {}

    try {
      const moviePlayer = document.getElementById('movie_player');
      if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
        const response = moviePlayer.getPlayerResponse();
        if (response) return response;
      }
    } catch {}

    return null;
  }

  function getCaptionTracksFromPlayerResponse(playerResponse) {
    try {
      const tracks =
        playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ||
        playerResponse?.captions?.playerCaptionsRenderer?.captionTracks ||
        [];
      return Array.isArray(tracks) ? tracks : [];
    } catch {
      return [];
    }
  }

  function pickBestCaptionTrack(tracks) {
    if (!Array.isArray(tracks) || !tracks.length) return null;
    const preferred = tracks.find((track) => String(track?.kind || '').toLowerCase() !== 'asr');
    return preferred || tracks[0] || null;
  }

  function parseTimedTextJson3(jsonText) {
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch {
      return [];
    }

    const events = Array.isArray(data?.events) ? data.events : [];
    const items = [];

    for (const event of events) {
      const segments = Array.isArray(event?.segs) ? event.segs : [];
      const text = segments
        .map((segment) => String(segment?.utf8 || '').replace(/\n+/g, ' ').trim())
        .filter(Boolean)
        .join('')
        .trim();
      const startMs = Number(event?.tStartMs);
      if (!text || !Number.isFinite(startMs)) continue;
      items.push({ time: formatTime(startMs / 1000), text });
    }

    return items;
  }

  function parseTimedTextXml(xmlText) {
    try {
      const documentXml = new DOMParser().parseFromString(xmlText, 'text/xml');
      return Array.from(documentXml.querySelectorAll('text'))
        .map((node) => {
          const start = Number(node.getAttribute('start'));
          const text = String(node.textContent || '').replace(/\n+/g, ' ').trim();
          if (!text) return null;
          return {
            time: Number.isFinite(start) ? formatTime(start) : '--:--',
            text
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function fetchTranscriptViaTimedText() {
    const playerResponse = getPlayerResponse();
    const tracks = getCaptionTracksFromPlayerResponse(playerResponse);
    const bestTrack = pickBestCaptionTrack(tracks);
    const baseUrl = bestTrack?.baseUrl;
    if (!baseUrl) return [];

    const transcriptUrl = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`;
    const response = await fetch(transcriptUrl, {
      credentials: 'include',
      cache: 'no-store'
    });
    const text = (await response.text()).trim();
    if (!text) return [];

    if (text.startsWith('<')) return parseTimedTextXml(text);
    return parseTimedTextJson3(text);
  }

  async function tryExpandDescription() {
    const selectors = [
      '#description-inline-expander #expand',
      '#description tp-yt-paper-button#expand',
      '#description #expand',
      'ytd-text-inline-expander #expand',
      'ytd-text-inline-expander tp-yt-paper-button#expand'
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && safeClick(button)) {
        await sleep(250);
        return true;
      }
    }

    return false;
  }

  function findTranscriptOpenButton() {
    const known = document.querySelector(
      'ytd-video-description-transcript-section-renderer button, ytd-video-description-transcript-section-renderer tp-yt-paper-button'
    );
    if (known) return known;

    const directPrimary = document.querySelector(
      '#primary-button ytd-button-renderer yt-button-shape button, #primary-button tp-yt-paper-button'
    );
    const directLabel = (directPrimary?.textContent || '').trim().toLowerCase();
    if (directPrimary && /transcript|транскрипт|расшифровка|стенограмма/.test(directLabel)) return directPrimary;

    const matchWords = ['transcript', 'show transcript', 'open transcript', 'транскрипт', 'расшифровка', 'стенограмма'];
    const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button'));

    for (const button of buttons) {
      if (button.id === DOWNLOAD_BUTTON_ID || button.id === PASTE_BUTTON_ID) continue;
      const text = (button.textContent || '').trim().toLowerCase();
      const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`.trim().toLowerCase();
      if (matchWords.some((word) => text.includes(word) || label.includes(word))) {
        return button;
      }
    }

    return null;
  }

  async function waitForTranscriptOpenButton(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const button = findTranscriptOpenButton();
      if (button) return button;
      await sleep(200);
    }
    return null;
  }

  function readTranscriptSegments() {
    const list = document.querySelector('ytd-transcript-segment-list-renderer');
    if (!list) return [];

    const seen = new Set();
    return Array.from(list.querySelectorAll('ytd-transcript-segment-renderer'))
      .map((segment) => {
        const timeNode = segment.querySelector('#timestamp') || segment.querySelector('.segment-timestamp');
        const textNode = segment.querySelector('#segment-text') || segment.querySelector('yt-formatted-string');
        const time = (timeNode?.textContent || '').trim();
        const text = (textNode?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!time && !text) return null;
        const key = `${time}\n${text}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return { time: time || '--:--', text: text || '' };
      })
      .filter(Boolean);
  }

  function getTranscriptScrollContainer() {
    const list = document.querySelector('ytd-transcript-segment-list-renderer');
    if (!list) return null;

    return (
      list.querySelector('#segments-container') ||
      list.querySelector('tp-yt-paper-dialog-scrollable') ||
      list.querySelector('yt-scrollbar') ||
      list
    );
  }

  async function readAllTranscriptSegments(maxMs) {
    const start = Date.now();
    const scroller = getTranscriptScrollContainer();
    if (!scroller) return [];

    let lastCount = 0;
    let stablePasses = 0;

    while (Date.now() - start < maxMs) {
      const items = readTranscriptSegments();
      const count = items.length;

      if (count > lastCount) {
        lastCount = count;
        stablePasses = 0;
      } else {
        stablePasses += 1;
      }

      try {
        scroller.scrollTop = scroller.scrollHeight;
      } catch {}

      if (stablePasses >= 6 && count > 0) return items;
      await sleep(250);
    }

    return readTranscriptSegments();
  }

  async function readTranscriptViaUi() {
    reviveTranscriptPanel();
    await waitForElement('ytd-watch-flexy', 8000);
    await tryExpandDescription();

    let panel = findTranscriptPanel();
    if (!panel || !isElementVisible(panel)) {
      const openButton = await waitForTranscriptOpenButton(7000);
      if (!openButton || !safeClick(openButton)) return [];
      await sleep(500);
      panel = findTranscriptPanel();
    }

    const list = await waitForElement('ytd-transcript-segment-list-renderer', 9000);
    if (!list) return [];

    const items = await readAllTranscriptSegments(45000);
    await dismissTranscriptPanelAfterCapture();
    return items;
  }

  async function getTranscriptItems() {
    try {
      const apiItems = await fetchTranscriptViaTimedText();
      if (apiItems.length) return apiItems;
    } catch {}

    return readTranscriptViaUi();
  }

  function buildTranscriptText(items) {
    return items
      .map((item) => {
        const time = String(item?.time || '').trim();
        const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
        if (!time) return text;
        return `[${time}] ${text}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  function buildMomentPromptBlock(title, url) {
    return [
      '### CHATGPT COMMAND 1',
      'Analyze the transcript above and return only valid JSON.',
      'Schema:',
      '{',
      `  "video_title": ${JSON.stringify(title)},`,
      `  "source_url": ${JSON.stringify(url)},`,
      '  "moments": [',
      '    { "title": "Short moment title", "time": "0:00" }',
      '  ]',
      '}',
      'Rules:',
      '- Return JSON only.',
      '- Keep 8 to 16 moments.',
      '- Sort moments by time ascending.',
      '- Use mm:ss or hh:mm:ss.',
      '- Titles must be short and readable.',
      '',
      '### CHATGPT COMMAND 2',
      'If I send you a moments JSON, clean and normalize it and return only valid JSON with the same schema.',
      'Rules:',
      '- Remove duplicates and overlaps.',
      '- Fix invalid timecodes.',
      '- Keep the strongest moments only.',
      '- Do not add markdown or explanations.'
    ].join('\n');
  }

  function buildTranscriptExport(title, url, transcriptText) {
    return `${title}\n${url}\n\n${transcriptText}\n\n${buildMomentPromptBlock(title, url)}\n`;
  }

  function downloadTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  }

  function getToast() {
    let toast = document.getElementById(TOAST_ID);
    if (toast) return toast;

    toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = 'ytp-transcript-download-toast';
    document.body.appendChild(toast);
    return toast;
  }

  function showToast(message, kind) {
    const toast = getToast();
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.classList.add('is-visible');

    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2400);
  }

  function setButtonState(button, state, label) {
    if (!button) return;
    button.dataset.state = state;
    button.disabled = state === 'loading';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('data-tooltip-title', label);
  }

  function resetButtonState(button) {
    setButtonState(button, 'idle', button?.dataset.defaultLabel || 'Action');
  }

  function setTemporaryState(button, state, label, timeoutMs) {
    setButtonState(button, state, label);
    window.setTimeout(() => {
      if (!button?.isConnected) return;
      if (button.dataset.state !== state) return;
      resetButtonState(button);
    }, timeoutMs);
  }

  function createActionButton({ id, label, iconMarkup, onClick }) {
    const button = document.createElement('button');
    button.id = id;
    button.className = ACTION_BUTTON_CLASS;
    button.type = 'button';
    button.dataset.state = 'idle';
    button.dataset.defaultLabel = label;
    button.innerHTML = `
      <span class="ytp-transcript-action-icon" aria-hidden="true">${iconMarkup}</span>
      <span class="ytp-transcript-action-spinner" aria-hidden="true">
        <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%" focusable="false" aria-hidden="true">
          <path
            d="M18 9.5a8.5 8.5 0 1 0 8.5 8.5"
            fill="none"
            stroke="#fff"
            stroke-linecap="round"
            stroke-width="2.6"
          ></path>
        </svg>
      </span>
    `;
    resetButtonState(button);

    button.addEventListener('click', async () => {
      if (button.dataset.state === 'loading') return;
      await onClick(button);
    });

    return button;
  }

  function createDownloadButton() {
    return createActionButton({
      id: DOWNLOAD_BUTTON_ID,
      label: 'Download subtitles',
      iconMarkup: `
        <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%" focusable="false" aria-hidden="true">
          <path
            d="M18,7.5 L18,21.2 L22.6,16.6 L24.0,18.0 L18,24.0 L12.0,18.0 L13.4,16.6 L16.0,19.2 L16.0,7.5 Z M11.0,27.0 L25.0,27.0 L25.0,29.0 L11.0,29.0 Z"
            fill="#fff"
          ></path>
        </svg>
      `,
      onClick: async (button) => {
        setButtonState(button, 'loading', 'Downloading subtitles...');

        try {
          const items = await getTranscriptItems();
          const transcriptText = buildTranscriptText(items);
          if (!transcriptText) throw new Error('Transcript unavailable');

          const title = getVideoTitle();
          const url = window.location.href;
          const fileContent = buildTranscriptExport(title, url, transcriptText);
          downloadTextFile(`${sanitizeFilename(title)}.txt`, fileContent);
          showToast('Subtitles downloaded with ChatGPT prompts', 'success');
          setTemporaryState(button, 'success', 'Downloaded', 2200);
        } catch {
          showToast('Transcript not available', 'error');
          setTemporaryState(button, 'error', 'Transcript not available', 2600);
        }
      }
    });
  }

  function createPasteButton() {
    return createActionButton({
      id: PASTE_BUTTON_ID,
      label: 'Paste moments JSON',
      iconMarkup: `
        <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%" focusable="false" aria-hidden="true">
          <path
            d="M14 7.5h8c1.1 0 2 .9 2 2V11h1.5c1.1 0 2 .9 2 2v13.5c0 1.1-.9 2-2 2h-15c-1.1 0-2-.9-2-2V13c0-1.1.9-2 2-2H12V9.5c0-1.1.9-2 2-2Zm0 2V11h8V9.5h-8Zm11.5 3.5h-15v13.5h15V13Zm-9.5 3h4v2h-4v-2Zm-2 4h8v2h-8v-2Z"
            fill="#fff"
          ></path>
        </svg>
      `,
      onClick: async (button) => {
        setButtonState(button, 'loading', 'Pasting moments JSON...');

        try {
          if (!navigator.clipboard?.readText) {
            throw new Error('Clipboard access is unavailable');
          }

          const clipboardText = await navigator.clipboard.readText();
          const moments = parseMomentsClipboardText(clipboardText);
          applyMomentsToCurrentVideo(moments);
          showToast(`Applied ${moments.length} custom moments`, 'success');
          setTemporaryState(button, 'success', 'Moments applied', 2200);
        } catch (error) {
          const message = String(error?.message || 'Invalid clipboard JSON');
          showToast(message, 'error');
          setTemporaryState(button, 'error', 'Invalid clipboard JSON', 2600);
        }
      }
    });
  }

  function stripCodeFence(text) {
    const trimmed = String(text || '').trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : trimmed;
  }

  function extractMomentItems(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of MOMENT_ITEM_KEYS) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  }

  function normalizeMoments(items) {
    const duration = getVideoDuration();
    const normalized = [];

    for (const [index, item] of items.entries()) {
      if (!item || typeof item !== 'object') continue;

      const title = String(
        item.title || item.name || item.label || item.chapter || item.moment || item.text || `Moment ${index + 1}`
      )
        .replace(/\s+/g, ' ')
        .trim();

      const rawTime =
        item.time ??
        item.timestamp ??
        item.timecode ??
        item.start ??
        item.startTime ??
        item.seconds ??
        item.at;

      const seconds = parseTimecode(rawTime);
      if (!title || !Number.isFinite(seconds)) continue;
      if (duration > 0 && seconds > duration + 1) continue;

      normalized.push({
        title,
        seconds,
        time: formatTime(seconds)
      });
    }

    normalized.sort((a, b) => a.seconds - b.seconds);

    const deduped = [];
    const seen = new Set();
    for (const moment of normalized) {
      const key = `${Math.floor(moment.seconds)}|${moment.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(moment);
    }

    return deduped;
  }

  function parseMomentsClipboardText(text) {
    const jsonText = stripCodeFence(text);
    if (!jsonText) throw new Error('Clipboard is empty');

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('Clipboard does not contain valid JSON');
    }

    const items = extractMomentItems(parsed);
    const moments = normalizeMoments(items);
    if (!moments.length) {
      throw new Error('JSON has no valid moments');
    }

    return moments;
  }

  function getStorageKey(videoId) {
    return `${MOMENTS_STORAGE_PREFIX}${videoId}`;
  }

  function getExtensionStorageArea() {
    try {
      return globalThis.chrome?.storage?.local || null;
    } catch {}
    return null;
  }

  function buildStoredMomentsPayload(videoId, moments) {
    return {
      version: MOMENTS_STORAGE_VERSION,
      videoId,
      updatedAt: Date.now(),
      moments
    };
  }

  async function readStoredValue(key) {
    const storageArea = getExtensionStorageArea();
    if (storageArea?.get) {
      try {
        const result = await storageArea.get(key);
        return result?.[key];
      } catch {}
    }

    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function writeStoredValue(key, value) {
    const storageArea = getExtensionStorageArea();
    if (storageArea?.set) {
      try {
        await storageArea.set({ [key]: value });
        return true;
      } catch {}
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function extractStoredMoments(payload) {
    if (!payload || typeof payload !== 'object') return [];
    const items = Array.isArray(payload?.moments) ? payload.moments : extractMomentItems(payload);
    return normalizeMoments(items);
  }

  async function saveMoments(videoId, moments) {
    if (!videoId) return false;
    const payload = buildStoredMomentsPayload(videoId, moments);
    return writeStoredValue(getStorageKey(videoId), payload);
  }

  async function loadMoments(videoId) {
    if (!videoId) return [];
    const payload = await readStoredValue(getStorageKey(videoId));
    return extractStoredMoments(payload);
  }

  function clearMomentUi() {
    document.getElementById(MOMENTS_PANEL_ID)?.remove();
    document.getElementById(MOMENTS_MARKERS_ID)?.remove();
    document.getElementById(MOMENTS_BADGE_ID)?.remove();
  }

  function getCurrentMoment() {
    if (!activeMoments.length) return null;
    const video = getVideoElement();
    const currentTime = Number(video?.currentTime || 0);

    let current = activeMoments[0];
    for (const moment of activeMoments) {
      if (moment.seconds <= currentTime + 0.25) {
        current = moment;
      } else {
        break;
      }
    }

    return current;
  }

  function seekToMoment(moment) {
    const video = getVideoElement();
    if (!video || !moment) return;

    try {
      video.currentTime = moment.seconds;
      video.dispatchEvent(new Event('timeupdate'));
    } catch {}
  }

  function renderMomentMarkers() {
    const host = document.querySelector('.ytp-timed-markers-container');
    if (!host || !activeMoments.length) {
      document.getElementById(MOMENTS_MARKERS_ID)?.remove();
      return;
    }

    const duration = getVideoDuration();
    if (!duration) {
      document.getElementById(MOMENTS_MARKERS_ID)?.remove();
      return;
    }

    let wrapper = document.getElementById(MOMENTS_MARKERS_ID);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = MOMENTS_MARKERS_ID;
      wrapper.className = 'ytp-custom-moments-markers';
      host.appendChild(wrapper);
    }

    wrapper.textContent = '';

    for (const moment of activeMoments) {
      const marker = document.createElement('button');
      marker.className = 'ytp-custom-moment-marker';
      marker.type = 'button';
      marker.style.left = `${clampPercent((moment.seconds / duration) * 100)}%`;
      marker.title = `${moment.time} ${moment.title}`;
      marker.setAttribute('aria-label', `${moment.time} ${moment.title}`);
      marker.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        seekToMoment(moment);
      });
      wrapper.appendChild(marker);
    }
  }

  function renderMomentBadge() {
    const timeDisplay = document.querySelector('.ytp-time-display');
    if (!timeDisplay || !activeMoments.length) {
      document.getElementById(MOMENTS_BADGE_ID)?.remove();
      return;
    }

    let badge = document.getElementById(MOMENTS_BADGE_ID);
    if (!badge) {
      badge = document.createElement('button');
      badge.id = MOMENTS_BADGE_ID;
      badge.className = 'ytp-custom-moments-badge';
      badge.type = 'button';
      timeDisplay.insertAdjacentElement('afterend', badge);
    }

    const current = getCurrentMoment();
    badge.hidden = !current;
    if (!current) return;
    badge.textContent = current.title;
    badge.title = `${current.time} ${current.title}`;
    badge.onclick = () => seekToMoment(current);
  }

  function renderMomentPanel() {
    const playerRoot = getPlayerRoot();
    if (!playerRoot || !activeMoments.length) {
      document.getElementById(MOMENTS_PANEL_ID)?.remove();
      return;
    }

    let panel = document.getElementById(MOMENTS_PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = MOMENTS_PANEL_ID;
      panel.className = 'ytp-custom-moments-panel';
      playerRoot.appendChild(panel);
    }

    const current = getCurrentMoment();
    panel.textContent = '';

    const header = document.createElement('div');
    header.className = 'ytp-custom-moments-header';
    header.textContent = 'Custom moments';
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'ytp-custom-moments-list';

    for (const moment of activeMoments) {
      const item = document.createElement('button');
      item.className = 'ytp-custom-moment-item';
      if (current && current.seconds === moment.seconds && current.title === moment.title) {
        item.classList.add('is-active');
      }
      item.type = 'button';
      item.addEventListener('click', () => seekToMoment(moment));

      const time = document.createElement('span');
      time.className = 'ytp-custom-moment-time';
      time.textContent = moment.time;

      const title = document.createElement('span');
      title.className = 'ytp-custom-moment-title';
      title.textContent = moment.title;

      item.append(time, title);
      list.appendChild(item);
    }

    panel.appendChild(list);
  }

  function updateMomentUi() {
    if (!activeMoments.length) {
      clearMomentUi();
      return;
    }

    renderMomentMarkers();
    renderMomentBadge();
    renderMomentPanel();
  }

  async function applyMomentsToCurrentVideo(moments) {
    const videoId = getVideoId();
    if (!videoId) throw new Error('Open a YouTube watch page first');

    activeMoments = moments;
    activeMomentsVideoId = videoId;
    activeMomentsLoadedVideoId = videoId;
    updateMomentUi();

    const saved = await saveMoments(videoId, moments);
    if (!saved) {
      throw new Error('Moments applied, but local save failed');
    }
  }

  async function syncMomentsForCurrentVideo() {
    const videoId = getVideoId();
    if (!videoId) {
      activeMoments = [];
      activeMomentsVideoId = '';
      activeMomentsLoadedVideoId = '';
      clearMomentUi();
      return;
    }

    if (activeMomentsLoadedVideoId === videoId) {
      updateMomentUi();
      return;
    }

    if (activeMomentsVideoId !== videoId) {
      activeMoments = [];
      activeMomentsVideoId = videoId;
      clearMomentUi();
    }

    const requestId = ++momentsSyncRequestId;
    const stored = await loadMoments(videoId);
    if (requestId !== momentsSyncRequestId) return;

    activeMoments = stored;
    activeMomentsVideoId = videoId;
    activeMomentsLoadedVideoId = videoId;
    updateMomentUi();
  }

  function handleBoundVideoUpdate() {
    updateMomentUi();
  }

  function syncVideoListeners() {
    const video = getVideoElement();
    if (video === boundVideoElement) return;

    if (boundVideoElement) {
      boundVideoElement.removeEventListener('timeupdate', handleBoundVideoUpdate);
      boundVideoElement.removeEventListener('loadedmetadata', handleBoundVideoUpdate);
      boundVideoElement.removeEventListener('durationchange', handleBoundVideoUpdate);
      boundVideoElement.removeEventListener('seeking', handleBoundVideoUpdate);
      boundVideoElement.removeEventListener('seeked', handleBoundVideoUpdate);
    }

    boundVideoElement = video;
    if (!boundVideoElement) return;

    boundVideoElement.addEventListener('timeupdate', handleBoundVideoUpdate);
    boundVideoElement.addEventListener('loadedmetadata', handleBoundVideoUpdate);
    boundVideoElement.addEventListener('durationchange', handleBoundVideoUpdate);
    boundVideoElement.addEventListener('seeking', handleBoundVideoUpdate);
    boundVideoElement.addEventListener('seeked', handleBoundVideoUpdate);
  }

  function getControlsHost() {
    return (
      document.querySelector('.ytp-right-controls .ytp-right-controls-right') ||
      document.querySelector('.ytp-right-controls-right') ||
      document.querySelector('.ytp-right-controls')
    );
  }

  function ensureButtons() {
    const downloadExisting = document.getElementById(DOWNLOAD_BUTTON_ID);
    const pasteExisting = document.getElementById(PASTE_BUTTON_ID);

    if (!isWatchPage()) {
      downloadExisting?.remove();
      pasteExisting?.remove();
      clearMomentUi();
      return;
    }

    const host = getControlsHost();
    if (!host) return;

    const downloadButton = downloadExisting || createDownloadButton();
    const pasteButton = pasteExisting || createPasteButton();
    const fullscreen = host.querySelector('.ytp-fullscreen-button');

    if (downloadButton.parentElement !== host) {
      if (fullscreen?.parentElement === host) {
        host.insertBefore(downloadButton, fullscreen);
      } else {
        host.appendChild(downloadButton);
      }
      resetButtonState(downloadButton);
    }

    if (pasteButton.parentElement !== host) {
      if (fullscreen?.parentElement === host) {
        host.insertBefore(pasteButton, fullscreen);
      } else {
        host.appendChild(pasteButton);
      }
      resetButtonState(pasteButton);
    }
  }

  function scheduleEnsureButton() {
    if (ensureScheduled) return;
    ensureScheduled = true;

    window.requestAnimationFrame(() => {
      ensureScheduled = false;
      const currentVideoId = getVideoId();
      if (currentVideoId !== lastVideoId) {
        lastVideoId = currentVideoId;
        resetButtonState(document.getElementById(DOWNLOAD_BUTTON_ID));
        resetButtonState(document.getElementById(PASTE_BUTTON_ID));
      }

      syncVideoListeners();
      ensureButtons();
      void syncMomentsForCurrentVideo();
    });
  }

  function startObservers() {
    const observer = new MutationObserver(() => scheduleEnsureButton());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const navigationEvents = ['yt-navigate-finish', 'yt-page-data-updated', 'spfdone'];
    for (const eventName of navigationEvents) {
      document.addEventListener(eventName, scheduleEnsureButton, true);
    }

    window.addEventListener('popstate', scheduleEnsureButton, true);
    window.addEventListener('load', scheduleEnsureButton, true);
    window.setInterval(scheduleEnsureButton, 1500);
  }

  lastVideoId = getVideoId();
  startObservers();
  scheduleEnsureButton();
})();
