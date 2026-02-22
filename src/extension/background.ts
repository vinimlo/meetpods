export {};

const TAG = '[MeetPods:bg]';
const WS_URL = 'ws://127.0.0.1:18432';
const RECONNECT_ALARM = 'reconnect';
const RECONNECT_PERIOD_MIN = 0.166; // ~10s

interface MeetTabInfo {
  url: string | undefined;
  lastFocused: number;
}

let ws: WebSocket | null = null;
let meetTabs = new Map<number, MeetTabInfo>();

function isWsConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

// Fix 2: Scan existing Meet tabs on service worker startup to recover state
chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
  console.log(`${TAG} Startup scan: found ${tabs.length} existing Meet tab(s)`);
  for (const tab of tabs) {
    meetTabs.set(tab.id!, { url: tab.url, lastFocused: tab.active ? Date.now() : 0 });
    console.log(`${TAG} Recovered tab ${tab.id}: ${tab.url}`);
  }
});

chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
  if (tab.url && tab.url.startsWith('https://meet.google.com/')) {
    if (!meetTabs.has(tabId)) {
      console.log(`${TAG} Meet tab added: ${tabId} — ${tab.url}`);
    }
    meetTabs.set(tabId, { url: tab.url, lastFocused: Date.now() });
  } else if (meetTabs.has(tabId)) {
    console.log(`${TAG} Meet tab removed: ${tabId}`);
    meetTabs.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (meetTabs.has(tabId)) {
    console.log(`${TAG} Meet tab closed: ${tabId}`);
  }
  meetTabs.delete(tabId);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (meetTabs.has(activeInfo.tabId)) {
    meetTabs.get(activeInfo.tabId)!.lastFocused = Date.now();
  }
});

function getBestMeetTab(): number | null {
  let best: number | null = null;
  let bestTime = 0;
  for (const [tabId, info] of meetTabs) {
    if (info.lastFocused > bestTime) {
      best = tabId;
      bestTime = info.lastFocused;
    }
  }
  return best;
}

async function sendToMeetTab(
  caller: string,
  messageType: string,
  fallback: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tabId = getBestMeetTab();
  console.log(`${TAG} ${caller}() — bestTab=${tabId}`);
  if (!tabId) return fallback;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: messageType });
    console.log(`${TAG} ${caller}() — tab ${tabId} responded:`, response);
    return { ...response, tabId };
  } catch (err) {
    console.log(`${TAG} ${caller}() — tab ${tabId} FAILED: ${(err as Error).message}`);
    meetTabs.delete(tabId);
    return fallback;
  }
}

function queryMeetStatus() {
  return sendToMeetTab('queryMeetStatus', 'get_status', { active: false, muted: false, tabId: null });
}

function toggleMuteOnMeet() {
  return sendToMeetTab('toggleMuteOnMeet', 'toggle_mute', { success: false, error: 'No Meet tab found' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(
    `${TAG} runtime.onMessage: type=${message.type}, from=${sender.tab ? 'tab ' + sender.tab.id : 'popup/internal'}`,
  );
  switch (message.type) {
    case 'check_electron_status':
      sendResponse({ connected: isWsConnected() });
      return false;
    case 'query_meet_status':
      queryMeetStatus().then(sendResponse);
      return true;
    case 'status_changed':
      if (isWsConnected()) {
        const tabId = sender.tab?.id ?? null;
        console.log(
          `${TAG} Relaying status_changed to Electron: active=${message.active}, muted=${message.muted}, tabId=${tabId}`,
        );
        ws!.send(
          JSON.stringify({
            type: 'meet_status',
            active: message.active,
            muted: message.muted,
            tabId,
          }),
        );
      }
      return false;
  }
});

function connectWS(): void {
  if (isWsConnected()) return;
  try {
    console.log(`${TAG} Connecting to ${WS_URL}...`);
    ws = new WebSocket(WS_URL);
    ws.onopen = () => {
      console.log(`${TAG} WebSocket connected to Electron app`);
      chrome.alarms.clear(RECONNECT_ALARM);
    };
    ws.onmessage = async (event: MessageEvent) => {
      const message = JSON.parse(event.data);
      console.log(`${TAG} WS received: ${message.type}`);
      switch (message.type) {
        case 'query_meet_status': {
          const status = await queryMeetStatus();
          ws!.send(JSON.stringify({ type: 'meet_status', ...status, requestId: message.requestId }));
          break;
        }
        case 'toggle_mute': {
          const result = await toggleMuteOnMeet();
          ws!.send(JSON.stringify({ type: 'mute_toggled', ...result, requestId: message.requestId }));
          break;
        }
        case 'ping':
          ws!.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    };
    ws.onclose = () => {
      console.log(`${TAG} WebSocket closed`);
      ws = null;
      scheduleReconnect();
    };
    ws.onerror = () => {
      console.log(`${TAG} WebSocket error`);
      // Don't set ws = null or scheduleReconnect here — onclose always fires after onerror
    };
  } catch {
    console.log(`${TAG} WebSocket connection failed`);
    scheduleReconnect();
  }
}

function tryReconnect(): void {
  if (isWsConnected()) return;
  connectWS();
}

function scheduleReconnect(): void {
  console.log(`${TAG} Scheduling reconnect alarm`);
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_PERIOD_MIN });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) {
    tryReconnect();
  }
});

connectWS();
