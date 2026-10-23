import { insertUi } from './insert-ui';
import { updateUI } from './update-state';
import log from './log';
import getFromStorage from '../../utils/getFromStorage';
import { addAlbums } from './album-selects-update';
import { actionsListenersSetUp } from './action-bar';
import { albumSelectsControlsSetUp } from './album-selects-controls';
import controlButtonsListeners from './main-control-buttons';
import advancedSettingsListenersSetUp from './advanced-settings';
import filterListenersSetUp from './filter-listeners';
import registerMenuCommand from './register-menu-command';
import type { Album } from '../../types';
import { recoveryKey } from '../../locked-date-repair';
import { windowGlobalData } from '../../windowGlobalData';

export default function initUI(): void {
  registerMenuCommand();
  insertUi();
  actionsListenersSetUp();
  filterListenersSetUp();
  controlButtonsListeners();
  albumSelectsControlsSetUp();
  advancedSettingsListenersSetUp();
  updateUI();
  try {
    if (localStorage.getItem(recoveryKey(windowGlobalData.account)) !== null) {
      log('Locked Folder recovery pending. Open and authenticate to Locked Folder and use Recover locked photo. Do not clear site data.', 'error');
    }
  } catch {
    log('Browser storage is unavailable. Locked Folder date repair requires persistent recovery storage.', 'error');
  }

  const cachedAlbums = getFromStorage<Album[]>('albums');
  if (cachedAlbums) {
    log('Cached Albums Restored');
    addAlbums(cachedAlbums);
  }

  window.addEventListener('beforeunload', function (e: BeforeUnloadEvent) {
    let pending = false;
    try { pending = localStorage.getItem(recoveryKey(windowGlobalData.account)) !== null; } catch { /* Active-action guard still applies. */ }
    if (unsafeWindow.gptkCore.isProcessRunning || unsafeWindow.gptkCore.isActionInFlight || pending) {
      e.preventDefault();
    }
  });
}
