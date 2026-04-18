(() => {
  const BUTTON_ID = 'ytp-transcript-download-button';
  const TOAST_ID = 'ytp-transcript-download-toast';
  const BUTTON_CLASS = 'ytp-button ytp-transcript-download-button';
  const TRANSCRIPT_PANEL_SELECTORS = [
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    '#panels ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
  ];

  let lastVideoId = '';
  let ensureScheduled = false;
  let toastTimer = null;

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
    return String(value || 'youtube-transcript')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'youtube-transcript';
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }

  async function waitForElement(selector, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const element = document.querySelector(selector);
      if (element) return element;
      await sleep(150);
    }
    return null;
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
      if (button.id === BUTTON_ID) continue;
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
    }, 2200);
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
    setButtonState(button, 'idle', 'Download transcript');
  }

  function setTemporaryState(button, state, label, timeoutMs) {
    setButtonState(button, state, label);
    window.setTimeout(() => {
      if (!button.isConnected) return;
      if (button.dataset.state !== state) return;
      resetButtonState(button);
    }, timeoutMs);
  }

  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = BUTTON_CLASS;
    button.type = 'button';
    button.dataset.state = 'idle';
    button.innerHTML = `
      <span class="ytp-transcript-download-icon" aria-hidden="true">
        <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%" focusable="false" aria-hidden="true">
          <path
            d="M18,7.5 L18,21.2 L22.6,16.6 L24.0,18.0 L18,24.0 L12.0,18.0 L13.4,16.6 L16.0,19.2 L16.0,7.5 Z M11.0,27.0 L25.0,27.0 L25.0,29.0 L11.0,29.0 Z"
            fill="#fff"
          ></path>
        </svg>
      </span>
      <span class="ytp-transcript-download-spinner" aria-hidden="true">
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

      setButtonState(button, 'loading', 'Downloading transcript...');

      try {
        const items = await getTranscriptItems();
        const transcriptText = buildTranscriptText(items);
        if (!transcriptText) throw new Error('Transcript unavailable');

        const title = getVideoTitle();
        const header = `${title}\n${window.location.href}\n\n`;
        downloadTextFile(`${sanitizeFilename(title)}.txt`, header + transcriptText);
        showToast('Subtitles downloaded', 'success');
        setTemporaryState(button, 'success', 'Subtitles downloaded', 2200);
      } catch {
        showToast('Transcript not available', 'error');
        setTemporaryState(button, 'error', 'Transcript not available', 2600);
      }
    });

    return button;
  }

  function getControlsHost() {
    return (
      document.querySelector('.ytp-right-controls .ytp-right-controls-right') ||
      document.querySelector('.ytp-right-controls-right') ||
      document.querySelector('.ytp-right-controls')
    );
  }

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (!isWatchPage()) {
      existing?.remove();
      return;
    }

    const host = getControlsHost();
    if (!host) return;

    if (existing && existing.parentElement === host) {
      const currentVideoId = getVideoId();
      if (currentVideoId !== lastVideoId) resetButtonState(existing);
      return;
    }

    const button = existing || createButton();
    const fullscreen = host.querySelector('.ytp-fullscreen-button');
    if (fullscreen?.parentElement === host) {
      host.insertBefore(button, fullscreen);
    } else {
      host.appendChild(button);
    }

    resetButtonState(button);
  }

  function scheduleEnsureButton() {
    if (ensureScheduled) return;
    ensureScheduled = true;
    window.requestAnimationFrame(() => {
      ensureScheduled = false;
      const currentVideoId = getVideoId();
      if (currentVideoId !== lastVideoId) {
        lastVideoId = currentVideoId;
        const button = document.getElementById(BUTTON_ID);
        if (button) resetButtonState(button);
      }
      ensureButton();
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
