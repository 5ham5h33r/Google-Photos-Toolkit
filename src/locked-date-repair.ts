import { proposeRepairDate } from './utils/repairDateFromFilename';
import type { RepairTimestamp } from './utils/repairDateFromFilename';
import type { ItemInfoExt, LockedFolderPage, LibraryTimelinePage, MediaItem, Filter } from './types';

export interface RepairApi {
  getLockedFolderItems(pageId?: string | null): Promise<LockedFolderPage>;
  getItemsByTakenDate(
    timestamp?: number | null,
    source?: string | null,
    pageId?: string | null,
    pageSize?: number
  ): Promise<LibraryTimelinePage>;
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

// Only metadata reads before a date write may be skipped. Restoration failures,
// account changes, identity mismatches and uncertain writes must stop the run.
class MetadataReadError extends Error {}

/** Reject filters that would need metadata reads outside the controlled repair flow. */
export function validateLockedRepairFilter(filter: Filter): void {
  const unsupported: Array<keyof Filter> = [
    'fileNameRegex',
    'descriptionRegex',
    'space',
    'quality',
    'lowerBoundarySize',
    'higherBoundarySize',
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'similarityThreshold',
    'sortBySize',
    'hasLocation',
    'boundSouth',
    'boundWest',
    'boundNorth',
    'boundEast',
    'albumsExclude',
    'excludeShared',
    'owned',
    'archived',
    'favorite',
    'excludeFavorites',
    'uploadStatus',
  ];
  if (filter.type === 'live' || unsupported.some((key) => Boolean(filter[key]))) {
    throw new Error(
      'Locked date repair supports date interval, Image/Video type and duration filters only. Reset unsupported filters before continuing.'
    );
  }
}

/** Validate the numeric cap used when Process all is unchecked. */
export function lockedRepairLimit(value = '1'): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Locked date repair limit must be a whole number from 1 to 100.');
  return limit;
}

/** Read this account's pending item; malformed entries must block another unlock. */
export function readRepairRecovery(storage: Pick<Storage, 'getItem'>, account: string): RepairRecovery | null {
  const raw = storage.getItem(recoveryKey(account));
  if (raw === null) return null;
  const data: unknown = JSON.parse(raw);
  if (
    typeof data !== 'object' ||
    data === null ||
    !('version' in data) ||
    data.version !== 1 ||
    !('account' in data) ||
    data.account !== account ||
    !('mediaKey' in data) ||
    typeof data.mediaKey !== 'string' ||
    !data.mediaKey ||
    !('dedupKey' in data) ||
    typeof data.dedupKey !== 'string' ||
    !data.dedupKey
  ) {
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

  private async lockedItems(cancellable = false): Promise<Map<string, MediaItem>> {
    this.options.assertAccount();
    const items = new Map<string, MediaItem>();
    const pages = new Set<string>();
    let pageId: string | null = null;
    do {
      if (cancellable && !this.options.running()) return new Map();
      this.options.assertAccount();
      const page = await this.options.api.getLockedFolderItems(pageId);
      if (!page || !Array.isArray(page.items))
        throw new Error('Cannot verify Locked Folder: unexpected page response.');
      for (const item of page.items) {
        if (
          typeof item?.mediaKey !== 'string' ||
          !item.mediaKey ||
          typeof item.dedupKey !== 'string' ||
          !item.dedupKey
        ) {
          throw new Error('Cannot verify Locked Folder: missing photo identifiers.');
        }
        if (items.has(item.dedupKey) && items.get(item.dedupKey)?.mediaKey !== item.mediaKey) {
          throw new Error('Cannot verify Locked Folder: conflicting photo identifiers.');
        }
        items.set(item.dedupKey, item);
      }
      if (page.nextPageId != null && (typeof page.nextPageId !== 'string' || !page.nextPageId)) {
        throw new Error('Cannot verify Locked Folder: invalid page token.');
      }
      pageId = page.nextPageId ?? null;
      if (pageId) {
        if (pages.has(pageId)) throw new Error('Cannot verify Locked Folder: repeated page token.');
        pages.add(pageId);
      }
    } while (pageId);
    return items;
  }

  /** List the source without unlocking anything. Failed pages never yield a partial selection. */
  async scan(): Promise<MediaItem[]> {
    const items = [...(await this.lockedItems(true)).values()];
    this.options.log(`Locked Folder scan complete: ${items.length} items found. No photos opened.`);
    return items;
  }

  private save(item: RepairItem): void {
    const { storage, account } = this.options;
    storage.setItem(
      recoveryKey(account),
      JSON.stringify({ version: 1, account, mediaKey: item.mediaKey, dedupKey: item.dedupKey })
    );
    if (readRepairRecovery(storage, account)?.dedupKey !== item.dedupKey)
      throw new Error('Could not save recovery entry. No photo was opened.');
  }

  private async restore(item: RepairItem): Promise<void> {
    const { api, storage, account, assertAccount } = this.options;
    assertAccount();
    // Always request restoration, including when the unlock response was lost.
    // A stale folder listing must never cause us to omit the restoration request.
    try {
      await api.moveToLockedFolder([item.dedupKey]);
    } catch {
      /* A lost response may still have committed. Verify below. */
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      assertAccount();
      try {
        if ((await this.lockedItems()).has(item.dedupKey)) {
          storage.removeItem(recoveryKey(account));
          if (storage.getItem(recoveryKey(account)) !== null) throw new Error('Could not clear recovery entry.');
          this.options.log('Return verified: item is back in Locked Folder; recovery entry cleared.');
          return;
        }
      } catch (error) {
        if (attempt === 2) throw error;
      }
      await (this.options.wait?.() ?? new Promise((resolve) => setTimeout(resolve, 500)));
    }
    throw new Error(
      'Photo is not confirmed back in Locked Folder. Recovery entry retained; use Recover locked photo before continuing.'
    );
  }

  /** Return the journaled item even after Stop, without scanning candidates or changing dates. */
  async recover(): Promise<void> {
    const item = readRepairRecovery(this.options.storage, this.options.account);
    if (!item) {
      this.options.log('No Locked Folder recovery is pending.');
      return;
    }
    await this.restore(item);
    this.options.log('Recovery verified: photo is back in Locked Folder.');
  }

  private async libraryKey(item: MediaItem): Promise<string> {
    // Google uses different mediaKeys inside and outside Locked Folder. Match
    // only the stable dedupKey, using a bounded timeline lookup near its date.
    if (!Number.isSafeInteger(item.timestamp))
      throw new MetadataReadError('Cannot locate the library item without a valid source date.');
    for (let attempt = 0; attempt < 3; attempt++) {
      let timestamp = item.timestamp + 1000;
      let pageId: string | null = null;
      const pages = new Set<string>();
      for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
        if (!this.options.running()) throw new MetadataReadError('Stopped before reading library metadata.');
        this.options.assertAccount();
        const page = await this.options.api.getItemsByTakenDate(timestamp, null, pageId, 50);
        if (!page || !Array.isArray(page.items)) throw new MetadataReadError('Invalid library lookup response.');
        const matches = page.items.filter((candidate) => candidate.dedupKey === item.dedupKey);
        if (matches.length > 1) throw new MetadataReadError('Ambiguous library identifiers.');
        if (matches.length === 1) {
          const key = matches[0].mediaKey;
          if (typeof key !== 'string' || !key)
            throw new MetadataReadError('Library lookup is missing the photo identifier.');
          return key;
        }
        if (page.nextPageId == null) break;
        if (typeof page.nextPageId !== 'string' || !page.nextPageId || pages.has(page.nextPageId)) {
          throw new MetadataReadError('Invalid or repeated library page token.');
        }
        pages.add(page.nextPageId);
        if (!Number.isSafeInteger(page.lastItemTimestamp))
          throw new MetadataReadError('Invalid library pagination date.');
        if (page.lastItemTimestamp < item.timestamp - 1000) break;
        pageId = page.nextPageId;
        // Keep equal timestamps eligible: the page token distinguishes ties.
        timestamp = Math.min(timestamp, page.lastItemTimestamp + 1);
      }
      if (attempt < 2) await (this.options.wait?.() ?? new Promise((resolve) => setTimeout(resolve, 500)));
    }
    throw new MetadataReadError('The moved photo could not be located by its stable identifier in the library.');
  }

  private async withPhoto<T>(item: RepairItem, action: (info: ItemInfoExt) => Promise<T>): Promise<T> {
    const { api, running, storage, account, assertAccount } = this.options;
    assertAccount();
    if (readRepairRecovery(storage, account)) throw new Error('Recover the previous photo before opening another.');
    const locked = (await this.lockedItems()).get(item.dedupKey);
    if (!locked) throw new Error('Selected photo is no longer in Locked Folder. Refresh the selection.');
    if (!running()) throw new Error('Stopped before opening a photo.');
    // Persist BEFORE the request: a lost unlock response must remain recoverable.
    this.save(locked);
    let actionError: Error | undefined;
    try {
      assertAccount();
      await api.removeFromLockedFolder([item.dedupKey]);
      if ((await this.lockedItems()).has(item.dedupKey))
        throw new Error('Could not verify that the photo moved out. No date was changed.');
      assertAccount();
      let info: ItemInfoExt;
      try {
        info = await api.getItemInfoExt(await this.libraryKey(locked));
      } catch (error) {
        throw new MetadataReadError(
          `Metadata request failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (!info?.dedupKey || !info.mediaKey)
        throw new MetadataReadError('Metadata response is missing photo identifiers.');
      if (info.dedupKey !== item.dedupKey) {
        throw new Error('Metadata identity mismatch. No date was changed; stopped for review.');
      }
      if (!info.fileName || !Number.isFinite(info.timestamp))
        throw new MetadataReadError('Metadata response is missing the filename or date.');
      assertAccount();
      return await action(info);
    } catch (error) {
      actionError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      // Includes exceptions, cancellation, failed edits, and ambiguous unlock responses.
      try {
        await this.restore(locked);
      } catch (error) {
        const cleanupError = error instanceof Error ? error.message : String(error);
        const details = actionError ? `Operation: ${actionError.message} Cleanup: ${cleanupError}` : cleanupError;
        throw new Error(
          `STOPPED: return to Locked Folder or recovery cleanup could not be verified. Keep site data and use Recover locked photo before continuing. ${details}`
        );
      }
    }
  }

  private async inspectItem(item: RepairItem): Promise<DateRepairPlan | null> {
    return this.withPhoto(item, (info) => {
      const after = proposeRepairDate(info.fileName ?? '', info.timestamp ?? NaN, info.timezoneOffset);
      if (!after || info.timestamp === undefined || info.timezoneOffset === undefined) return Promise.resolve(null);
      const before = {
        timestampSec: Math.floor(info.timestamp / 1000),
        timezoneSec: info.timezoneOffset / 1000,
      };
      if (before.timestampSec === after.timestampSec) return Promise.resolve(null);
      return Promise.resolve({ ...item, filename: info.fileName ?? '', before, after });
    });
  }

  private async applyPlan(plan: DateRepairPlan): Promise<boolean> {
    const { api, running, assertAccount } = this.options;
    return this.withPhoto(plan, async (info) => {
      if (!running()) return false;
      if (
        info.fileName !== plan.filename ||
        Math.floor((info.timestamp ?? NaN) / 1000) !== plan.before.timestampSec ||
        (info.timezoneOffset ?? NaN) / 1000 !== plan.before.timezoneSec
      ) {
        throw new Error('Photo changed since preview. No date was changed; start a new preview.');
      }
      assertAccount();
      let writeError: unknown;
      try {
        await api.setItemsTimestamp([{ dedupKey: plan.dedupKey, ...plan.after }]);
      } catch (error) {
        writeError = error;
      }

      // A lost response may still mean the write committed. Read it back before
      // reporting success or opening another item.
      assertAccount();
      let updated: ItemInfoExt;
      try {
        updated = await api.getItemInfoExt(info.mediaKey ?? plan.mediaKey);
      } catch {
        throw new Error(
          'Date write outcome is unknown: updated metadata could not be read. Stopped for review; do not assume the date stayed unchanged.'
        );
      }
      if (
        updated.dedupKey !== plan.dedupKey ||
        Math.floor((updated.timestamp ?? NaN) / 1000) !== plan.after.timestampSec ||
        (updated.timezoneOffset ?? NaN) / 1000 !== plan.after.timezoneSec
      ) {
        throw new Error(
          `Could not verify the updated date${writeError ? ' after a failed write response' : ''}. Stopped for review; do not assume the date stayed unchanged.`
        );
      }
      return true;
    });
  }

  /** Inspect a fixed selection, preview while everything is locked, then apply the approved plans. */
  async run(items: RepairItem[]): Promise<void> {
    const { storage, account, running, preview, log, assertAccount } = this.options;
    if (readRepairRecovery(storage, account)) throw new Error('Recovery pending. Use Recover locked photo first.');
    const plans: DateRepairPlan[] = [];
    let skipped = 0;
    let inspected = 0;
    const uniqueItems = [...new Map(items.map((item) => [item.dedupKey, item])).values()];
    for (const item of uniqueItems) {
      if (!running()) break;
      log(`Inspecting item ${++inspected}/${uniqueItems.length}. Only this item may temporarily leave Locked Folder.`);
      let plan: DateRepairPlan | null;
      try {
        plan = await this.inspectItem(item);
      } catch (error) {
        if (!(error instanceof MetadataReadError)) throw error;
        // withPhoto has completed verified restoration before this catch runs.
        assertAccount();
        if (readRepairRecovery(storage, account))
          throw new Error('Recovery pending after metadata failure. Stop and recover the photo.');
        skipped++;
        log(
          `Skipped item ${inspected}/${uniqueItems.length}: ${error.message} No date changed; return to Locked Folder verified.`
        );
        continue;
      }
      if (plan) plans.push(plan);
      else {
        skipped++;
        log('Skipped a photo with an unsupported filename, unknown timezone, or an already matching date.');
      }
    }
    log(
      `Inspection complete: ${inspected} inspected, ${skipped} skipped, ${plans.length} proposed changes. All opened items are back in Locked Folder.`
    );
    if (!running()) {
      log('Stopped. No date changes applied.');
      return;
    }
    if (!plans.length) {
      log('No date changes to apply.');
      return;
    }
    // Every photo is back in Locked Folder before the user sees the full preview.
    const selected = await preview(plans);
    if (!selected.length) {
      log('Preview cancelled or no changes selected. No dates were changed.');
      return;
    }
    let changed = 0;
    let attempted = 0;
    for (const plan of selected) {
      if (!running()) break;
      if (!plans.includes(plan)) throw new Error('Invalid preview selection.');
      log(`Applying selected change ${++attempted}/${selected.length}.`);
      try {
        if (await this.applyPlan(plan)) changed++;
      } catch (error) {
        if (!(error instanceof MetadataReadError)) throw error;
        assertAccount();
        log(`Skipped a selected change: ${error.message} No date write attempted for this item; return verified.`);
      }
    }
    log(
      `${running() ? 'Finished' : 'Stopped'}: verified ${changed} of ${selected.length} selected date changes. All opened photos were returned to Locked Folder.`
    );
  }
}

/** Hold the account lock through inspection, preview, editing and cleanup; reject competing tabs. */
export async function exclusiveLockedRepair<T>(account: string, action: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Locked Folder repair requires a browser with Web Locks support.');
  return navigator.locks.request(`gptk-locked-date-repair:${account}`, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('Another tab is repairing or recovering Locked Folder photos.');
    return action();
  });
}
