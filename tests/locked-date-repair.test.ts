import { describe, expect, it, vi } from 'vitest';
import {
  LockedDateRepair,
  recoveryKey,
  readRepairRecovery,
  exclusiveLockedRepair,
  lockedRepairLimit,
  validateLockedRepairFilter,
} from '../src/locked-date-repair';
import type { RepairApi, DateRepairPlan } from '../src/locked-date-repair';
import type { ItemInfoExt, MediaItem, LibraryTimelinePage } from '../src/types';

function fixture() {
  const account = 'test@example.invalid';
  const item: MediaItem = { mediaKey: 'media', dedupKey: 'dedup', timestamp: 0, creationTimestamp: 0 };
  const records = new Map<string, string>();
  const events: string[] = [];
  const storage = {
    getItem: vi.fn((key: string) => records.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      events.push('journal');
      records.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      events.push('clear');
      records.delete(key);
    }),
  };
  let running = true;
  let locked = true;
  let generation = 0;
  const info: ItemInfoExt = {
    mediaKey: 'media',
    dedupKey: 'dedup',
    fileName: '2017-05-04_uuid.jpg',
    timestamp: Date.parse('2026-10-22T12:34:56Z'),
    timezoneOffset: 0,
    source: [null, null],
  };
  const api = {
    getLockedFolderItems: vi.fn(() => Promise.resolve({ items: locked ? [item] : [] })),
    getItemsByTakenDate: vi.fn((): Promise<LibraryTimelinePage> =>
      Promise.resolve({
        items: locked ? [] : [{ ...item, mediaKey: info.mediaKey! }],
        lastItemTimestamp: item.timestamp,
      })
    ),
    getItemInfoExt: vi.fn((key: string) =>
      key === info.mediaKey && !locked ? Promise.resolve({ ...info }) : Promise.reject(new Error('Stale mediaKey'))
    ),
    removeFromLockedFolder: vi.fn(() => {
      events.push('unlock');
      locked = false;
      info.mediaKey = `library-${++generation}`;
      return Promise.resolve([]);
    }),
    moveToLockedFolder: vi.fn(() => {
      events.push('lock');
      locked = true;
      item.mediaKey = `locked-${++generation}`;
      return Promise.resolve([]);
    }),
    setItemsTimestamp: vi.fn((items: Array<{ timestampSec: number }>) => {
      events.push('edit');
      info.timestamp = items[0].timestampSec * 1000;
      return Promise.resolve([]);
    }),
  } satisfies RepairApi;
  const preview = vi.fn((plans: DateRepairPlan[]) => {
    expect(locked).toBe(true);
    events.push('preview');
    return Promise.resolve(plans);
  });
  const assertAccount = vi.fn();
  const log = vi.fn();
  const service = new LockedDateRepair({
    api,
    account,
    storage,
    running: () => running,
    preview,
    assertAccount,
    log,
    wait: () => Promise.resolve(),
  });
  return {
    account,
    item,
    records,
    storage,
    api,
    service,
    preview,
    events,
    info,
    assertAccount,
    log,
    stop: () => {
      running = false;
    },
    unlocked: () => {
      locked = false;
    },
    isLocked: () => locked,
  };
}

describe('Locked Folder repair lifecycle', () => {
  it('reports both the operation and cleanup failure while retaining recovery', async () => {
    const f = fixture();
    f.api.getItemInfoExt.mockRejectedValue(new Error('metadata unavailable'));
    f.api.moveToLockedFolder.mockRejectedValue(new Error('offline'));
    await expect(f.service.run([f.item])).rejects.toThrow(/Operation:.*metadata unavailable.*Cleanup:.*not confirmed/);
    expect(readRepairRecovery(f.storage, f.account)?.dedupKey).toBe(f.item.dedupKey);
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
  });
  it('defaults to a one-photo test and validates repair limits', () => {
    expect(lockedRepairLimit()).toBe(1);
    expect(lockedRepairLimit('100')).toBe(100);
    for (const value of ['0', '-1', '101', '1.5', 'NaN', ''])
      expect(() => lockedRepairLimit(value)).toThrow('1 to 100');
  });
  it('journals before unlock, relocks before preview, verifies edits and relocks again', async () => {
    const f = fixture();
    await f.service.run([f.item]);
    expect(f.events).toEqual([
      'journal',
      'unlock',
      'lock',
      'clear',
      'preview',
      'journal',
      'unlock',
      'edit',
      'lock',
      'clear',
    ]);
    expect(f.isLocked()).toBe(true);
    expect(f.info.timestamp).toBe(Date.parse('2017-05-04T12:34:56Z'));
    expect(f.records.size).toBe(0);
    expect(f.api.getItemInfoExt.mock.calls.map(([key]) => key)).toEqual(['library-1', 'library-3', 'library-3']);
  });
  it('does not unlock if recovery storage fails', async () => {
    const f = fixture();
    f.storage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    await expect(f.service.run([f.item])).rejects.toThrow('quota');
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
  it('uses a bounded date lookup and the fresh library key on every opening', async () => {
    const f = fixture();
    await f.service.run([f.item]);
    expect(f.api.getItemsByTakenDate).toHaveBeenCalledTimes(2);
    expect(f.api.getItemsByTakenDate).toHaveBeenCalledWith(1000, null, null, 50);
    expect(f.api.getItemInfoExt).not.toHaveBeenCalledWith('media');
  });
  it('does not fall back to a filename or stale key when a stable identifier cannot be found', async () => {
    const f = fixture();
    f.api.getItemsByTakenDate.mockResolvedValue({
      items: [{ ...f.item, dedupKey: 'someone-else' }],
      lastItemTimestamp: 0,
    });
    await f.service.run([f.item]);
    expect(f.api.getItemsByTakenDate).toHaveBeenCalledTimes(3);
    expect(f.api.getItemInfoExt).not.toHaveBeenCalled();
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
    expect(f.isLocked()).toBe(true);
    expect(f.records.size).toBe(0);
  });
  it('retries an eventually consistent library listing', async () => {
    const f = fixture();
    f.api.getItemsByTakenDate.mockResolvedValueOnce({ items: [], lastItemTimestamp: 0 });
    await f.service.run([f.item]);
    expect(f.api.setItemsTimestamp).toHaveBeenCalledTimes(1);
    expect(f.isLocked()).toBe(true);
  });
  it('follows equal-date pagination using its cursor without omitting ties', async () => {
    const f = fixture();
    f.api.getItemsByTakenDate.mockResolvedValueOnce({ items: [], nextPageId: 'tie-page', lastItemTimestamp: 0 });
    await f.service.run([f.item]);
    expect(f.api.getItemsByTakenDate).toHaveBeenNthCalledWith(2, 1, null, 'tie-page', 50);
    expect(f.api.setItemsTimestamp).toHaveBeenCalledTimes(1);
  });
  it.each(['repeated', 'malformed', 'missing-key', 'ambiguous', 'failed'])(
    'returns the photo without editing after a %s library lookup',
    async (scenario) => {
      const f = fixture();
      if (scenario === 'repeated')
        f.api.getItemsByTakenDate.mockResolvedValue({ items: [], nextPageId: 'same', lastItemTimestamp: 0 });
      if (scenario === 'malformed')
        f.api.getItemsByTakenDate.mockResolvedValue({ items: [], nextPageId: 'next', lastItemTimestamp: NaN });
      if (scenario === 'missing-key')
        f.api.getItemsByTakenDate.mockResolvedValue({ items: [{ ...f.item, mediaKey: '' }], lastItemTimestamp: 0 });
      if (scenario === 'ambiguous')
        f.api.getItemsByTakenDate.mockResolvedValue({
          items: [f.item, { ...f.item, mediaKey: 'different' }],
          lastItemTimestamp: 0,
        });
      if (scenario === 'failed') f.api.getItemsByTakenDate.mockRejectedValue(new Error('offline'));
      await f.service.run([f.item]);
      expect(f.api.getItemInfoExt).not.toHaveBeenCalled();
      expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
      expect(f.isLocked()).toBe(true);
      expect(f.records.size).toBe(0);
    }
  );
  it('bounds library pagination even when the server always returns a new token', async () => {
    const f = fixture();
    let page = 0;
    f.api.getItemsByTakenDate.mockImplementation(() =>
      Promise.resolve({ items: [], nextPageId: String(++page), lastItemTimestamp: 0 })
    );
    await f.service.run([f.item]);
    expect(f.api.getItemsByTakenDate).toHaveBeenCalledTimes(30);
    expect(f.isLocked()).toBe(true);
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
  });
  it('stops the lookup at dates older than the source item', async () => {
    const f = fixture();
    f.api.getItemsByTakenDate.mockResolvedValue({ items: [], nextPageId: 'older', lastItemTimestamp: -2000 });
    await f.service.run([f.item]);
    expect(f.api.getItemsByTakenDate).toHaveBeenCalledTimes(3);
    expect(f.isLocked()).toBe(true);
  });
  it('recovers a committed unlock whose response was lost', async () => {
    const f = fixture();
    f.api.removeFromLockedFolder.mockImplementation(() => {
      f.unlocked();
      return Promise.reject(new Error('lost response'));
    });
    await expect(f.service.run([f.item])).rejects.toThrow('lost response');
    expect(f.isLocked()).toBe(true);
    expect(f.records.size).toBe(0);
  });
  it('skips a metadata failure only after verified restoration, without a date write', async () => {
    const f = fixture();
    f.api.getItemInfoExt.mockRejectedValue(new Error('cannot read'));
    await f.service.run([f.item]);
    expect(f.isLocked()).toBe(true);
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
    expect(f.records.size).toBe(0);
    expect(f.log).toHaveBeenCalledWith(expect.stringContaining('No date changed; return to Locked Folder verified'));
  });
  it('relocks on Stop and does not show a preview or edit', async () => {
    const f = fixture();
    f.api.getItemInfoExt.mockImplementation(() => {
      f.stop();
      return Promise.resolve({ ...f.info });
    });
    await f.service.run([f.item]);
    expect(f.isLocked()).toBe(true);
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
  });
  it('cancels while all photos are locked', async () => {
    const f = fixture();
    f.preview.mockResolvedValue([]);
    await f.service.run([f.item]);
    expect(f.api.removeFromLockedFolder).toHaveBeenCalledTimes(1);
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
    expect(f.isLocked()).toBe(true);
  });
  it('relocks on edit failure', async () => {
    const f = fixture();
    f.api.setItemsTimestamp.mockRejectedValue(new Error('edit failed'));
    await expect(f.service.run([f.item])).rejects.toThrow('failed write response');
    expect(f.isLocked()).toBe(true);
  });
  it('retains recovery and stops before a second photo when restoration fails', async () => {
    const f = fixture();
    f.api.moveToLockedFolder.mockRejectedValue(new Error('offline'));
    await expect(f.service.run([f.item, { ...f.item, dedupKey: 'other' }])).rejects.toThrow('not confirmed');
    expect(f.api.removeFromLockedFolder).toHaveBeenCalledTimes(1);
    expect(readRepairRecovery(f.storage, f.account)?.dedupKey).toBe('dedup');
    expect(f.preview).not.toHaveBeenCalled();
  });
  it('recovers after reload without editing or depending on the item still being listed as locked', async () => {
    const f = fixture();
    f.unlocked();
    f.stop();
    f.records.set(recoveryKey(f.account), JSON.stringify({ version: 1, account: f.account, ...f.item }));
    await f.service.recover();
    expect(f.isLocked()).toBe(true);
    expect(f.records.size).toBe(0);
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
  });
  it('does not trust a successful lock response without membership verification', async () => {
    const f = fixture();
    f.api.moveToLockedFolder.mockResolvedValue([]);
    await expect(f.service.run([f.item])).rejects.toThrow('not confirmed');
    expect(f.records.size).toBe(1);
  });
  it('clears recovery when a lost lock response nevertheless restored membership', async () => {
    const f = fixture();
    const lock = f.api.moveToLockedFolder.getMockImplementation()!;
    f.api.moveToLockedFolder.mockImplementation(() => {
      void lock();
      return Promise.reject(new Error('lost reply'));
    });
    await f.service.run([f.item]);
    expect(f.isLocked()).toBe(true);
    expect(f.records.size).toBe(0);
  });
  it('does not count an unverified date response as a successful repair', async () => {
    const f = fixture();
    f.api.setItemsTimestamp.mockResolvedValue([]);
    await expect(f.service.run([f.item])).rejects.toThrow('verify the updated date');
    expect(f.isLocked()).toBe(true);
  });
  it('rejects stale preview plans and relocks', async () => {
    const f = fixture();
    f.preview.mockImplementation((plans) => {
      f.info.fileName = 'changed.jpg';
      return Promise.resolve(plans);
    });
    await expect(f.service.run([f.item])).rejects.toThrow('changed since preview');
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
    expect(f.isLocked()).toBe(true);
  });
  it('skips unknown filenames and missing offsets, returning each photo', async () => {
    const f = fixture();
    f.info.fileName = 'Snapchat-421429335.jpg';
    await f.service.run([f.item]);
    f.info.fileName = '2017-05-04.jpg';
    f.info.timezoneOffset = undefined;
    await f.service.run([f.item]);
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.isLocked()).toBe(true);
  });
  it('fails closed on a malformed recovery record', async () => {
    const f = fixture();
    f.records.set(recoveryKey(f.account), '{}');
    await expect(f.service.run([f.item])).rejects.toThrow('Invalid Locked Folder recovery');
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
  it('refuses to mutate after an account switch', async () => {
    const f = fixture();
    f.assertAccount.mockImplementation(() => {
      throw new Error('account changed');
    });
    await expect(f.service.run([f.item])).rejects.toThrow('account changed');
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
  it('does not clear recovery if a folder page cannot be verified', async () => {
    const f = fixture();
    f.records.set(recoveryKey(f.account), JSON.stringify({ version: 1, account: f.account, ...f.item }));
    f.api.getLockedFolderItems.mockRejectedValue(new Error('offline'));
    await expect(f.service.recover()).rejects.toThrow('offline');
    expect(f.records.size).toBe(1);
  });
  it('verifies membership beyond the first page during recovery', async () => {
    const f = fixture();
    f.records.set(recoveryKey(f.account), JSON.stringify({ version: 1, account: f.account, ...f.item }));
    f.api.getLockedFolderItems
      .mockResolvedValueOnce({ items: [], nextPageId: 'second' })
      .mockResolvedValueOnce({ items: [f.item] });
    await f.service.recover();
    expect(f.api.getLockedFolderItems).toHaveBeenNthCalledWith(2, 'second');
    expect(f.records.size).toBe(0);
  });
  it('refuses to clear recovery on a repeated pagination token', async () => {
    const f = fixture();
    f.records.set(recoveryKey(f.account), JSON.stringify({ version: 1, account: f.account, ...f.item }));
    f.api.getLockedFolderItems.mockResolvedValue({ items: [], nextPageId: 'repeated' });
    await expect(f.service.recover()).rejects.toThrow('repeated page token');
    expect(f.records.size).toBe(1);
  });
  it('refuses overlapping repairs in another tab', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: (_name: string, _opts: unknown, callback: (lock: null) => Promise<unknown>) => callback(null) },
    });
    const action = vi.fn();
    await expect(exclusiveLockedRepair('account', action)).rejects.toThrow('Another tab');
    expect(action).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not turn a failed metadata read into a skip when relocking fails', async () => {
    const f = fixture();
    f.api.getItemInfoExt.mockRejectedValue(new Error('Missing payload in parsed response'));
    f.api.moveToLockedFolder.mockRejectedValue(new Error('offline'));
    await expect(f.service.run([f.item, { ...f.item, dedupKey: 'next' }])).rejects.toThrow('STOPPED');
    expect(f.api.removeFromLockedFolder).toHaveBeenCalledTimes(1);
    expect(f.records.size).toBe(1);
    expect(f.log.mock.calls.some(([message]) => String(message).startsWith('Skipped'))).toBe(false);
  });
  it('stops on an identity mismatch and returns the original item', async () => {
    const f = fixture();
    f.api.getItemInfoExt.mockResolvedValue({ ...f.info, dedupKey: 'wrong' });
    await expect(f.service.run([f.item])).rejects.toThrow('identity mismatch');
    expect(f.isLocked()).toBe(true);
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
  });
  it('skips incomplete metadata and returns the item', async () => {
    const f = fixture();
    f.api.getItemInfoExt.mockResolvedValue({ ...f.info, fileName: undefined });
    await f.service.run([f.item]);
    expect(f.isLocked()).toBe(true);
    expect(f.preview).not.toHaveBeenCalled();
  });
  it('verifies an edit that committed even though its response was lost', async () => {
    const f = fixture();
    f.api.setItemsTimestamp.mockImplementation((items) => {
      f.info.timestamp = items[0].timestampSec * 1000;
      return Promise.reject(new Error('lost response'));
    });
    await f.service.run([f.item]);
    expect(f.isLocked()).toBe(true);
    expect(f.log).toHaveBeenCalledWith(expect.stringContaining('verified 1 of 1'));
  });
  it('stops with an uncertain outcome if metadata cannot be read after a write', async () => {
    const f = fixture();
    f.api.getItemInfoExt
      .mockResolvedValueOnce({ ...f.info })
      .mockResolvedValueOnce({ ...f.info })
      .mockRejectedValueOnce(new Error('offline'));
    await expect(f.service.run([f.item])).rejects.toThrow('outcome is unknown');
    expect(f.isLocked()).toBe(true);
    expect(f.api.setItemsTimestamp).toHaveBeenCalledTimes(1);
  });
  it('does not edit if metadata becomes unavailable after the preview', async () => {
    const f = fixture();
    f.api.getItemInfoExt.mockResolvedValueOnce({ ...f.info }).mockRejectedValueOnce(new Error('offline'));
    await f.service.run([f.item]);
    expect(f.isLocked()).toBe(true);
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledWith(expect.stringContaining('No date write attempted'));
  });
  it('rejects a partial source scan before opening anything', async () => {
    const f = fixture();
    f.api.getLockedFolderItems
      .mockResolvedValueOnce({ items: [f.item], nextPageId: 'next' })
      .mockRejectedValueOnce(new Error('page failed'));
    await expect(f.service.scan()).rejects.toThrow('page failed');
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
  it('stops a cancelled scan between pages without returning a partial selection', async () => {
    const f = fixture();
    f.api.getLockedFolderItems.mockImplementationOnce(() => {
      f.stop();
      return Promise.resolve({ items: [f.item], nextPageId: 'next' });
    });
    expect(await f.service.scan()).toEqual([]);
    expect(f.api.getLockedFolderItems).toHaveBeenCalledTimes(1);
  });
  it('rejects filters that would read metadata before the controlled unlock', () => {
    expect(() => validateLockedRepairFilter({ fileNameRegex: 'jpg' })).toThrow('supports');
    expect(() => validateLockedRepairFilter({ similarityThreshold: '0.8' })).toThrow('supports');
    expect(() => validateLockedRepairFilter({ type: 'video', minDuration: '1' })).not.toThrow();
  });
  it('rejects non-string photo identifiers before writing any recovery state', async () => {
    const f = fixture();
    f.api.getLockedFolderItems.mockResolvedValue({ items: [{ ...f.item, mediaKey: 123 as unknown as string }] });
    await expect(f.service.run([f.item])).rejects.toThrow('missing photo identifiers');
    expect(f.records.size).toBe(0);
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
  it('rejects conflicting identifiers in source pages before opening a photo', async () => {
    const f = fixture();
    f.api.getLockedFolderItems
      .mockResolvedValueOnce({ items: [f.item], nextPageId: 'next' })
      .mockResolvedValueOnce({ items: [{ ...f.item, mediaKey: 'different' }] });
    await expect(f.service.scan()).rejects.toThrow('conflicting');
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
});

describe('multiple Locked Folder items', () => {
  it('skips one failed item, then previews and edits the next, never opening two together', async () => {
    const locked = new Set(['bad', 'good']);
    const api: RepairApi = {
      getLockedFolderItems: vi.fn(() =>
        Promise.resolve({
          items: [...locked].map((key) => ({ mediaKey: key, dedupKey: key, timestamp: 0, creationTimestamp: 0 })),
        })
      ),
      getItemsByTakenDate: vi.fn(() =>
        Promise.resolve({
          items: ['bad', 'good']
            .filter((key) => !locked.has(key))
            .map((key) => ({ mediaKey: key, dedupKey: key, timestamp: 0, creationTimestamp: 0 })),
          lastItemTimestamp: 0,
        })
      ),
      removeFromLockedFolder: vi.fn((keys) => {
        expect(locked.size).toBe(2);
        locked.delete(keys[0]);
        return Promise.resolve([]);
      }),
      moveToLockedFolder: vi.fn((keys) => {
        locked.add(keys[0]);
        return Promise.resolve([]);
      }),
      getItemInfoExt: vi.fn((key) =>
        key === 'bad'
          ? Promise.reject(new Error('Missing payload in parsed response'))
          : Promise.resolve({
              mediaKey: key,
              dedupKey: key,
              fileName: '2020-01-02.jpg',
              timestamp: date,
              timezoneOffset: 0,
              source: [null, null],
            })
      ),
      setItemsTimestamp: vi.fn((items) => {
        date = items[0].timestampSec * 1000;
        return Promise.resolve([]);
      }),
    };
    let date = Date.parse('2026-10-22T12:30:00Z');
    const records = new Map<string, string>();
    const preview = vi.fn((plans: DateRepairPlan[]) => {
      expect(locked.size).toBe(2);
      expect(plans.map((p) => p.dedupKey)).toEqual(['good']);
      return Promise.resolve(plans);
    });
    const service = new LockedDateRepair({
      api,
      account: 'test',
      storage: {
        getItem: (key) => records.get(key) ?? null,
        setItem: (key, val) => {
          records.set(key, val);
        },
        removeItem: (key) => {
          records.delete(key);
        },
      },
      running: () => true,
      assertAccount: () => {},
      preview,
      log: vi.fn(),
    });
    await service.run([
      { mediaKey: 'bad', dedupKey: 'bad' },
      { mediaKey: 'good', dedupKey: 'good' },
    ]);
    expect(date).toBe(Date.parse('2020-01-02T12:30:00Z'));
    expect(api.setItemsTimestamp).toHaveBeenCalledWith([expect.objectContaining({ dedupKey: 'good' })]);
    expect(locked.size).toBe(2);
    expect(records.size).toBe(0);
  });
});
