import { app, dialog, shell } from 'electron';

const REPO_OWNER = 'vinimlo';
const REPO_NAME = 'meetpods';

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  name: string;
}

function compareVersions(current: string, latest: string): number {
  const c = current.replace(/^v/, '').split('.').map(Number);
  const l = latest.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const diff = (l[i] || 0) - (c[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function checkForUpdates(silent = false): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, {
      headers: { 'User-Agent': `MeetPods/${app.getVersion()}` },
    });

    if (!res.ok) {
      if (!silent) {
        dialog.showMessageBox({
          type: 'error',
          title: 'Update Check Failed',
          message: `Could not check for updates (HTTP ${res.status}).`,
        });
      }
      return;
    }

    const release = (await res.json()) as GitHubRelease;
    const latest = release.tag_name;
    const current = app.getVersion();

    if (compareVersions(current, latest) > 0) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `A new version of MeetPods is available: ${release.name || latest}`,
        detail: `You are running v${current}. Would you like to download the update?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
      });
      if (response === 0) {
        shell.openExternal(release.html_url);
      }
    } else if (!silent) {
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates Available',
        message: `You're running the latest version (v${current}).`,
      });
    }
  } catch {
    if (!silent) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not connect to GitHub to check for updates.',
      });
    }
  }
}
