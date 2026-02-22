export {};

const dotElectron = document.getElementById('dot-electron')!;
const badgeElectron = document.getElementById('badge-electron')!;
const dotMeet = document.getElementById('dot-meet')!;
const badgeMeet = document.getElementById('badge-meet')!;
const dotMic = document.getElementById('dot-mic')!;
const badgeMic = document.getElementById('badge-mic')!;

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

function setMeetStatus(active: boolean, muted: boolean): void {
  if (!active) {
    dotMeet.className = 'status-dot dim';
    badgeMeet.className = 'status-badge inactive';
    badgeMeet.textContent = 'No call';
    dotMic.className = 'status-dot dim';
    badgeMic.className = 'status-badge inactive';
    badgeMic.textContent = '--';
    return;
  }

  dotMeet.className = 'status-dot green';
  badgeMeet.className = 'status-badge connected';
  badgeMeet.textContent = 'In call';

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

// Query Meet status via background script
async function checkMeetViaBackground(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'query_meet_status' });
    if (response && response.active !== undefined) {
      setMeetStatus(response.active, response.muted);
    }
  } catch {
    // Background might not respond if no Meet tabs
  }
}

// Run checks — both go through background script, no direct WebSocket
checkElectronConnection();
checkMeetViaBackground();
