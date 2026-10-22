import { proposeRepairDate } from './utils/repairDateFromFilename';
import type { RepairTimestamp } from './utils/repairDateFromFilename';
import type { ItemInfoExt, LockedFolderPage, MediaItem } from './types';

export interface RepairApi {
  getLockedFolderItems(pageId?: string | null): Promise<LockedFolderPage>;
  getItemInfoExt(mediaKey: string): Promise<ItemInfoExt>;
  removeFromLockedFolder(keys: string[]): Promise<unknown>;
  moveToLockedFolder(keys: string[]): Promise<unknown>;
  setItemsTimestamp(items: Array<RepairTimestamp & { dedupKey: string }>): Promise<unknown>;
}

export interface RepairItem {
  mediaKey: string;
  dedupKey: string;
}

export interface DateRepairPlan extends RepairItem {
  filename: string;
  before: RepairTimestamp;
  after: RepairTimestamp;
}

export interface RepairRecovery extends RepairItem {
  version: 1;
  account: string;
}

export const recoveryKey = (account: string): string => `gptk-locked-date-recovery:${account}`;

export function lockedRepairLimit(value = '1'): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Locked date repair limit must be a whole number from 1 to 100.');
  return limit;
}

export function readRepairRecovery(storage: Pick<Storage, 'getItem'>, account: string): RepairRecovery | null {
  const raw = storage.getItem(recoveryKey(account));
  if (raw === null) return null;
  const data: unknown = JSON.parse(raw);
  if (typeof data !== 'object' || data === null || !('version' in data) || data.version !== 1 ||
      !('account' in data) || data.account !== account || !('mediaKey' in data) || typeof data.mediaKey !== 'string' || !data.mediaKey ||
      !('dedupKey' in data) || typeof data.dedupKey !== 'string' || !data.dedupKey) {
    throw new Error('Invalid Locked Folder recovery entry. Keep it and recover the photo manually before continuing.');
  }
  return { version: 1, account, mediaKey: data.mediaKey, dedupKey: data.dedupKey };
}

interface RepairOptions {
  api: RepairApi;
  account: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  running: () => boolean;
  assertAccount: () => void;
  preview: (plans: DateRepairPlan[]) => Promise<DateRepairPlan[]>;
  log: (message: string) => void;
  wait?: () => Promise<void>;
}

/** One item may be outside Locked Folder at a time; recovery never obeys Stop. */
export class LockedDateRepair {
  constructor(private options: RepairOptions) {}

  private async lockedItems(): Promise<Map<string, MediaItem>> {
    this.options.assertAccount();
    const items = new Map<string, MediaItem>();
    const pages = new Set<string>();
    let pageId: string | null = null;
    do {
      const page = await this.options.api.getLockedFolderItems(pageId);
      if (!page || !Array.isArray(page.items)) throw new Error('Cannot verify Locked Folder: unexpected page response.');
      for (const item of page.items) {
        if (!item.mediaKey || !item.dedupKey) throw new Error('Cannot verify Locked Folder: missing photo identifiers.');
        items.set(item.dedupKey, item);
      }
      pageId = page.nextPageId ?? null;
      if (pageId) {
        if (pages.has(pageId)) throw new Error('Cannot verify Locked Folder: repeated page token.');
        pages.add(pageId);
      }
    } while (pageId);
    return items;
  }

  private save(item: RepairItem): void {
    const {storage, account} = this.options;
    storage.setItem(recoveryKey(account), JSON.stringify({version: 1, account, mediaKey: item.mediaKey, dedupKey: item.dedupKey}));
    if (readRepairRecovery(storage, account)?.dedupKey !== item.dedupKey) throw new Error('Could not save recovery entry. No photo was opened.');
  }

  private async restore(item: RepairItem): Promise<void> {
    const {api, storage, account, assertAccount} = this.options;
    assertAccount();
    // Always request restoration, including when the unlock response was lost.
    // A stale folder listing must never cause us to omit the restoration request.
    try { await api.moveToLockedFolder([item.dedupKey]); } catch { /* A lost response may still have committed. Verify below. */ }
    for (let attempt = 0; attempt < 3; attempt++) {
      assertAccount();
      try {
        if ((await this.lockedItems()).has(item.dedupKey)) {
          storage.removeItem(recoveryKey(account));
          if (storage.getItem(recoveryKey(account)) !== null) throw new Error('Could not clear recovery entry.');
          return;
        }
      } catch (error) {
        if (attempt === 2) throw error;
      }
      await (this.options.wait?.() ?? new Promise(resolve => setTimeout(resolve, 500)));
    }
    throw new Error('Photo is not confirmed back in Locked Folder. Recovery entry retained; use Recover locked photo before continuing.');
  }

  async recover(): Promise<void> {
    const item = readRepairRecovery(this.options.storage, this.options.account);
    if (!item) { this.options.log('No Locked Folder recovery is pending.'); return; }
    await this.restore(item);
    this.options.log('Recovery verified: photo is back in Locked Folder.');
  }

  private async withPhoto<T>(item: RepairItem, action: (info: ItemInfoExt) => Promise<T>): Promise<T> {
    const {api, running, storage, account, assertAccount} = this.options;
    assertAccount();
    if (readRepairRecovery(storage, account)) throw new Error('Recover the previous photo before opening another.');
    const locked = (await this.lockedItems()).get(item.dedupKey);
    if (!locked) throw new Error('Selected photo is no longer in Locked Folder. Refresh the selection.');
    if (!running()) throw new Error('Stopped before opening a photo.');
    // Persist BEFORE the request: a lost unlock response must remain recoverable.
    this.save(locked);
    try {
      assertAccount();
      await api.removeFromLockedFolder([item.dedupKey]);
      if ((await this.lockedItems()).has(item.dedupKey)) throw new Error('Could not verify that the photo moved out. No date was changed.');
      assertAccount();
      const info = await api.getItemInfoExt(locked.mediaKey);
      if (info?.dedupKey !== item.dedupKey || !info.mediaKey || !info.fileName || !Number.isFinite(info.timestamp)) {
        throw new Error('Cannot identify the opened photo or read its date. No date was changed.');
      }
      return await action(info);
    } finally {
      // Includes exceptions, cancellation, failed edits, and ambiguous unlock responses.
      await this.restore(locked);
    }
  }

  async run(items: RepairItem[]): Promise<void> {
    const {storage, account, running, api, preview, log, assertAccount} = this.options;
    if (readRepairRecovery(storage, account)) throw new Error('Recovery pending. Use Recover locked photo first.');
    const plans: DateRepairPlan[] = [];
    for (const item of new Map(items.map(item => [item.dedupKey, item])).values()) {
      if (!running()) break;
      const plan = await this.withPhoto(item, info => {
        const after = proposeRepairDate(info.fileName ?? '', info.timestamp ?? NaN, info.timezoneOffset);
        if (!after || info.timestamp === undefined || info.timezoneOffset === undefined) return Promise.resolve(null);
        const before = {timestampSec: Math.floor(info.timestamp / 1000), timezoneSec: info.timezoneOffset / 1000};
        if (before.timestampSec === after.timestampSec) return Promise.resolve(null);
        return Promise.resolve({ ...item, filename: info.fileName ?? '', before, after });
      });
      if (plan) plans.push(plan);
      else log('Skipped a photo with an unsupported filename, unknown timezone, or an already matching date.');
    }
    if (!running() || !plans.length) { log('No date changes to apply. All opened photos were returned to Locked Folder.'); return; }
    // Every photo is back in Locked Folder before the user sees the full preview.
    const selected = await preview(plans);
    let changed = 0;
    for (const plan of selected) {
      if (!running()) break;
      if (!plans.includes(plan)) throw new Error('Invalid preview selection.');
      await this.withPhoto(plan, async info => {
        if (!running()) return;
        if (info.fileName !== plan.filename || Math.floor((info.timestamp ?? NaN) / 1000) !== plan.before.timestampSec ||
            (info.timezoneOffset ?? NaN) / 1000 !== plan.before.timezoneSec) {
          throw new Error('Photo changed since preview. No date was changed; start a new preview.');
        }
        assertAccount();
        await api.setItemsTimestamp([{dedupKey: plan.dedupKey, ...plan.after}]);
        const updated = await api.getItemInfoExt(info.mediaKey ?? plan.mediaKey);
        if (updated.dedupKey !== plan.dedupKey || Math.floor((updated.timestamp ?? NaN) / 1000) !== plan.after.timestampSec ||
            (updated.timezoneOffset ?? NaN) / 1000 !== plan.after.timezoneSec) {
          throw new Error('Could not verify the updated date. Photo will be returned to Locked Folder; review it before retrying.');
        }
        changed++;
      });
    }
    log(`Verified ${changed} date changes. All opened photos were returned to Locked Folder.`);
  }
}

export async function exclusiveLockedRepair<T>(account: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Locked Folder repair requires a browser with Web Locks support.');
  return navigator.locks.request(`gptk-locked-date-repair:${account}`, {ifAvailable: true}, async lock => {
    if (!lock) throw new Error('Another tab is repairing or recovering Locked Folder photos.');
    return action();
  });
}
