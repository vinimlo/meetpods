export {};

interface TabListEntry {
  tabId: number;
  title: string;
  url: string | undefined;
  active: boolean;
  muted: boolean;
}

const dotElectron = document.getElementById('dot-electron')!;
const badgeElectron = document.getElementById('badge-electron')!;
const dotMeet = document.getElementById('dot-meet')!;
const badgeMeet = document.getElementById('badge-meet')!;
const dotMic = document.getElementById('dot-mic')!;
const badgeMic = document.getElementById('badge-mic')!;
const rowMic = document.getElementById('row-mic')!;
const toggleHint = document.getElementById('toggle-hint')!;
const tabsSection = document.getElementById('tabs-section')!;
const tabsCount = document.getElementById('tabs-count')!;
const tabsList = document.getElementById('tabs-list')!;

function setElectronStatus(connected: boolean): void {
  if (connected) {
    dotElectron.className = 'status-dot green';
    badgeElectron.className = 'status-badge connected';
    badgeElectron.textContent = 'Connected';
  } else {
    dotElectron.className = 'status-dot red';
    badgeElectron.className = 'status-badge disconnected';
    badgeElectron.textContent = 'Offline';
  }
}

let callActive = false;

function setMeetStatus(active: boolean, muted: boolean): void {
  callActive = active;

  if (!active) {
    dotMeet.className = 'status-dot dim';
    badgeMeet.className = 'status-badge inactive';
    badgeMeet.textContent = 'No call';
    dotMic.className = 'status-dot dim';
    badgeMic.className = 'status-badge inactive';
    badgeMic.textContent = '--';
    rowMic.classList.remove('clickable');
    toggleHint.style.display = 'none';
    return;
  }

  dotMeet.className = 'status-dot green';
  badgeMeet.className = 'status-badge connected';
  badgeMeet.textContent = 'In call';
  rowMic.classList.add('clickable');
  toggleHint.style.display = '';

  if (muted) {
    dotMic.className = 'status-dot red';
    badgeMic.className = 'status-badge muted';
    badgeMic.textContent = 'Muted';
  } else {
    dotMic.className = 'status-dot green';
    badgeMic.className = 'status-badge mic-on';
    badgeMic.textContent = 'Mic ON';
  }
}

// Query Electron connection status via background script (no direct WebSocket)
async function checkElectronConnection(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'check_electron_status' });
    setElectronStatus(response?.connected ?? false);
  } catch {
    setElectronStatus(false);
  }
}

function renderTabRow(tab: TabListEntry, isPinned: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = `tab-row${isPinned ? ' pinned' : ''}`;

  const info = document.createElement('div');
  info.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title;
  title.title = tab.title;

  const meta = document.createElement('div');
  meta.className = 'tab-meta';

  const dot = document.createElement('div');
  dot.className = `tab-status-dot ${tab.active ? 'active' : 'inactive'}`;

  const label = document.createElement('span');
  label.className = 'tab-status-label';
  if (tab.active) {
    label.textContent = tab.muted ? 'In call · Muted' : 'In call · Mic on';
  } else {
    label.textContent = 'No call';
  }

  meta.appendChild(dot);
  meta.appendChild(label);
  info.appendChild(title);
  info.appendChild(meta);

  const pinBtn = document.createElement('button');
  pinBtn.className = `pin-btn${isPinned ? ' pinned' : ''}`;
  pinBtn.innerHTML = isPinned ? '&#x1F4CC;' : '&#x25CB;';
  pinBtn.title = isPinned ? 'Unpin this tab' : 'Pin this tab as mute target';
  pinBtn.addEventListener('click', async () => {
    const type = isPinned ? 'unpin_tab' : 'pin_tab';
    await chrome.runtime.sendMessage({ type, tabId: tab.tabId });
    loadTabList();
  });

  row.appendChild(info);
  row.appendChild(pinBtn);

  return row;
}

async function loadTabList(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_tab_list' });
    if (!response || !response.tabs) return;

    const tabs: TabListEntry[] = response.tabs;
    const pinnedId: number | null = response.pinnedTabId;

    // Update status rows from the pinned/target tab (or first active tab)
    const targetTab = tabs.find((t) => t.tabId === pinnedId) ?? tabs.find((t) => t.active);
    if (targetTab) {
      setMeetStatus(targetTab.active, targetTab.muted);
    } else {
      setMeetStatus(false, false);
    }

    // Show/hide tabs section
    if (tabs.length === 0) {
      tabsSection.style.display = 'none';
      return;
    }

    tabsSection.style.display = '';
    tabsCount.textContent = String(tabs.length);

    // Render tab list
    tabsList.innerHTML = '';
    for (const tab of tabs) {
      tabsList.appendChild(renderTabRow(tab, tab.tabId === pinnedId));
    }
  } catch {
    // Background might not respond if no Meet tabs
  }
}

// Set version from manifest
document.getElementById('version-label')!.textContent = `v${chrome.runtime.getManifest().version}`;

// Mute toggle via mic row click
rowMic.addEventListener('click', async () => {
  if (!callActive) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'toggle_mute' });
    if (response?.success) {
      setMeetStatus(true, response.muted);
    }
    // Refresh tab list to sync state
    loadTabList();
  } catch {
    // Background might not respond
  }
});

// Run checks — both go through background script, no direct WebSocket
checkElectronConnection();
loadTabList();
