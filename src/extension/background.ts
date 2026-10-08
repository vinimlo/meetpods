export {};

import { detectPlatformFromUrl, PLATFORM_URL_PATTERNS } from './platforms/registry';
import type { PlatformId } from './platforms/types';

const TAG = '[MeetPods:bg]';
const WS_URL = 'ws://127.0.0.1:18432';
const RECONNECT_ALARM = 'reconnect';
const RECONNECT_PERIOD_MIN = 0.166; // ~10s

interface MeetTabInfo {
  url: string | undefined;
  platform: PlatformId;
  lastFocused: number;
  active: boolean;
  muted: boolean;
  title: string;
}

interface TabListEntry {
  tabId: number;
  title: string;
  url: string | undefined;
  platform: PlatformId;
  active: boolean;
  muted: boolean;
}

let ws: WebSocket | null = null;
let meetTabs = new Map<number, MeetTabInfo>();
let pinnedTabId: number | null = null;
let pinnedManually: boolean = false;

function isWsConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

// Content scripts die with the tab and can't push `active: false` before they go.
// When the last tab in an active call disappears (closed or navigated away), synthesize
// the inactive push here — otherwise Electron keeps AUHAL running and the mic stays open.
function notifyElectronIfNoActiveCallsRemain(): void {
  for (const info of meetTabs.values()) {
    if (info.active) return;
  }
  if (isWsConnected()) {
    console.log(`${TAG} No active call tabs remain — notifying Electron (active=false)`);
    ws!.send(JSON.stringify({ type: 'meet_status', active: false, muted: false, tabId: null }));
  }
}

function clearPin(): void {
  pinnedTabId = null;
  pinnedManually = false;
}

function pinTab(tabId: number): boolean {
  if (!meetTabs.has(tabId)) return false;
  pinnedTabId = tabId;
  pinnedManually = true;
  return true;
}

function extractCallId(platform: PlatformId, url: string | undefined): string {
  if (!url) return '';
  switch (platform) {
    case 'meet': {
      const match = url.match(/meet\.google\.com\/([a-z]+-[a-z]+-[a-z]+)/);
      return match ? match[1] : '';
    }
    case 'zoom': {
      const match = url.match(/zoom\.us\/(?:wc|meeting)\/(\d+)/);
      return match ? match[1] : '';
    }
    case 'teams': {
      const match = url.match(/meetup-join\/([^/?]+)/);
      return match ? match[1] : '';
    }
  }
}

const PLATFORM_DISPLAY: Record<PlatformId, string> = {
  meet: 'Meet',
  zoom: 'Zoom',
  teams: 'Teams',
};

// Scan existing platform tabs on service worker startup to recover state
for (const pattern of PLATFORM_URL_PATTERNS) {
  chrome.tabs.query({ url: pattern }, (tabs) => {
    console.log(`${TAG} Startup scan (${pattern}): found ${tabs.length} tab(s)`);
    for (const tab of tabs) {
      const platform = detectPlatformFromUrl(tab.url ?? '');
      if (!platform) continue;
      meetTabs.set(tab.id!, {
        url: tab.url,
        platform,
        lastFocused: tab.active ? Date.now() : 0,
        active: false,
        muted: false,
        title: tab.title ?? '',
      });
      console.log(`${TAG} Recovered tab ${tab.id}: ${tab.url} (${platform})`);
    }
  });
}

chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
  const platform = tab.url ? detectPlatformFromUrl(tab.url) : null;
  if (platform) {
    if (!meetTabs.has(tabId)) {
      console.log(`${TAG} ${platform} tab added: ${tabId} — ${tab.url}`);
      meetTabs.set(tabId, {
        url: tab.url,
        platform,
        lastFocused: Date.now(),
        active: false,
        muted: false,
        title: tab.title ?? '',
      });
    } else {
      const info = meetTabs.get(tabId)!;
      info.url = tab.url;
      info.platform = platform;
      info.lastFocused = Date.now();
      info.title = tab.title ?? info.title;
    }
  } else if (meetTabs.has(tabId)) {
    console.log(`${TAG} Platform tab removed: ${tabId}`);
    const wasActive = meetTabs.get(tabId)!.active;
    meetTabs.delete(tabId);
    if (tabId === pinnedTabId) clearPin();
    if (wasActive) notifyElectronIfNoActiveCallsRemain();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const wasActive = meetTabs.get(tabId)?.active === true;
  if (meetTabs.has(tabId)) {
    console.log(`${TAG} Platform tab closed: ${tabId}`);
  }
  meetTabs.delete(tabId);
  if (tabId === pinnedTabId) clearPin();
  if (wasActive) notifyElectronIfNoActiveCallsRemain();
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

function getTargetTab(): number | null {
  console.log(
    `${TAG} getTargetTab() — meetTabs=${meetTabs.size}, pinnedTabId=${pinnedTabId}, pinnedManually=${pinnedManually}`,
  );
  for (const [tabId, info] of meetTabs) {
    console.log(
      `${TAG}   tab ${tabId}: active=${info.active}, muted=${info.muted}, platform=${info.platform}, title="${info.title}"`,
    );
  }

  // 1. Pinned tab — if it exists and has an active call
  if (pinnedTabId !== null && meetTabs.has(pinnedTabId)) {
    const info = meetTabs.get(pinnedTabId)!;
    if (info.active) {
      console.log(`${TAG} getTargetTab() → pinned tab ${pinnedTabId} (active call)`);
      return pinnedTabId;
    }
    console.log(`${TAG} getTargetTab() — pinned tab ${pinnedTabId} exists but call not active, falling through`);
  }

  // 2. Auto-detect — find tabs with active calls
  const activeTabs: [number, MeetTabInfo][] = [];
  for (const [tabId, info] of meetTabs) {
    if (info.active) activeTabs.push([tabId, info]);
  }

  if (activeTabs.length === 1) {
    pinnedTabId = activeTabs[0][0];
    pinnedManually = false;
    console.log(`${TAG} getTargetTab() → auto-pinned tab ${pinnedTabId} (only active call)`);
    return pinnedTabId;
  }

  if (activeTabs.length > 1) {
    let best: number | null = null;
    let bestTime = 0;
    for (const [tabId, info] of activeTabs) {
      if (info.lastFocused > bestTime) {
        best = tabId;
        bestTime = info.lastFocused;
      }
    }
    pinnedTabId = best;
    pinnedManually = false;
    console.log(`${TAG} getTargetTab() → best of ${activeTabs.length} active tabs: ${pinnedTabId}`);
    return pinnedTabId;
  }

  // 3. No active calls — fall back to most recently focused tab
  const fallback = getBestMeetTab();
  console.log(`${TAG} getTargetTab() → no active calls, fallback to best tab: ${fallback}`);
  return fallback;
}

async function sendToMeetTab(
  caller: string,
  messageType: string,
  fallback: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tabId = getTargetTab();
  console.log(`${TAG} ${caller}() — targetTab=${tabId}`);
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

async function toggleMuteOnTab() {
  const tabId = getTargetTab();
  console.log(`${TAG} toggleMuteOnTab() — targetTab=${tabId}`);
  if (!tabId) return { success: false, error: 'No call tab found' };

  // Some platforms (e.g. Google Meet's Wiz framework) ignore synthetic clicks on background tabs.
  // Briefly focus the tab so .click() works, then restore the previous tab.
  let previousTabId: number | null = null;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab?.id && activeTab.id !== tabId) {
      previousTabId = activeTab.id;
      console.log(`${TAG} toggleMuteOnTab() — focusing tab ${tabId} (was: ${previousTabId})`);
      await chrome.tabs.update(tabId, { active: true });
      await new Promise((r) => setTimeout(r, 50));
    }
  } catch (err) {
    console.log(`${TAG} toggleMuteOnTab() — tab focus failed: ${(err as Error).message}`);
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'toggle_mute' });
    console.log(`${TAG} toggleMuteOnTab() — tab ${tabId} responded:`, response);
    return { ...response, tabId };
  } catch (err) {
    console.log(`${TAG} toggleMuteOnTab() — tab ${tabId} FAILED: ${(err as Error).message}`);
    meetTabs.delete(tabId);
    return { success: false, error: 'Content script unreachable' };
  } finally {
    if (previousTabId !== null) {
      console.log(`${TAG} toggleMuteOnTab() — restoring previous tab ${previousTabId}`);
      chrome.tabs.update(previousTabId, { active: true }).catch(() => {});
    }
  }
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
    case 'status_changed': {
      const tabId = sender.tab?.id ?? null;
      const wasActive = tabId !== null && meetTabs.get(tabId)?.active === true;
      // Content scripts report their initial state on load. An idle tab saying "not in a
      // call" must not switch MeetPods off while another tab is in one.
      if (!message.active && !wasActive) return false;
      if (tabId !== null && meetTabs.has(tabId)) {
        const info = meetTabs.get(tabId)!;
        info.active = message.active;
        info.muted = message.muted;
        if (tabId === pinnedTabId && !message.active) {
          clearPin();
        }
      }
      if (isWsConnected()) {
        const platform = tabId !== null && meetTabs.has(tabId) ? meetTabs.get(tabId)!.platform : undefined;
        console.log(
          `${TAG} Relaying status_changed to Electron: active=${message.active}, muted=${message.muted}, tabId=${tabId}, platform=${platform}`,
        );
        ws!.send(
          JSON.stringify({
            type: 'meet_status',
            active: message.active,
            muted: message.muted,
            tabId,
            ...(platform && { platform }),
          }),
        );
      }
      return false;
    }
    case 'get_tab_list': {
      const tabs: TabListEntry[] = [];
      for (const [tabId, info] of meetTabs) {
        const displayName = PLATFORM_DISPLAY[info.platform];
        tabs.push({
          tabId,
          title: info.title || `${displayName} (${extractCallId(info.platform, info.url) || 'unknown'})`,
          url: info.url,
          platform: info.platform,
          active: info.active,
          muted: info.muted,
        });
      }
      tabs.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
      sendResponse({ tabs, pinnedTabId });
      return false;
    }
    case 'pin_tab': {
      const success = pinTab(message.tabId);
      sendResponse({ success, pinnedTabId });
      return false;
    }
    case 'unpin_tab':
      clearPin();
      sendResponse({ success: true, pinnedTabId: null });
      return false;
    case 'toggle_mute':
      toggleMuteOnTab().then(sendResponse);
      return true;
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
          console.log(`${TAG} WS toggle_mute — requestId=${message.requestId}, ws.readyState=${ws!.readyState}`);
          const result = await toggleMuteOnTab();
          console.log(`${TAG} WS toggle_mute — result:`, JSON.stringify(result));
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'mute_toggled', ...result, requestId: message.requestId }));
            console.log(`${TAG} WS toggle_mute — response sent`);
          } else {
            console.log(
              `${TAG} WS toggle_mute — CANNOT RESPOND (ws=${ws ? 'exists' : 'null'}, readyState=${ws?.readyState})`,
            );
          }
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
