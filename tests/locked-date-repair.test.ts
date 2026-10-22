import {describe, expect, it, vi} from 'vitest';
import {LockedDateRepair, recoveryKey, readRepairRecovery, exclusiveLockedRepair} from '../src/locked-date-repair';
import type {RepairApi, DateRepairPlan} from '../src/locked-date-repair';
import type {ItemInfoExt, MediaItem} from '../src/types';

function fixture() {
  const account = 'test@example.invalid';
  const item: MediaItem = {mediaKey:'media', dedupKey:'dedup', timestamp:0, creationTimestamp:0};
  const records = new Map<string,string>();
  const events: string[] = [];
  const storage = {
    getItem: vi.fn((key: string) => records.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {events.push('journal'); records.set(key,value);}),
    removeItem: vi.fn((key: string) => {events.push('clear'); records.delete(key);}),
  };
  let running = true;
  let locked = true;
  const info: ItemInfoExt = {mediaKey:'media', dedupKey:'dedup', fileName:'2017-05-04_uuid.jpg',
    timestamp:Date.parse('2026-10-22T12:34:56Z'), timezoneOffset:0, source:[null,null]};
  const api = {
    getLockedFolderItems: vi.fn(() => Promise.resolve({items: locked ? [item] : []})),
    getItemInfoExt: vi.fn(() => Promise.resolve({...info})),
    removeFromLockedFolder: vi.fn(() => {events.push('unlock'); locked = false; return Promise.resolve([]);}),
    moveToLockedFolder: vi.fn(() => {events.push('lock'); locked = true; return Promise.resolve([]);}),
    setItemsTimestamp: vi.fn((items: Array<{timestampSec:number}>) => {events.push('edit'); info.timestamp=items[0].timestampSec*1000; return Promise.resolve([]);}),
  } satisfies RepairApi;
  const preview = vi.fn((plans: DateRepairPlan[]) => {expect(locked).toBe(true); events.push('preview'); return Promise.resolve(plans);});
  const assertAccount = vi.fn();
  const service = new LockedDateRepair({api, account, storage, running:() => running, preview,
    assertAccount, log:vi.fn(), wait:() => Promise.resolve()});
  return {account,item,records,storage,api,service,preview,events,info,assertAccount,
    stop:() => {running=false;}, unlocked:() => {locked=false;}, isLocked:() => locked};
}

describe('Locked Folder repair lifecycle', () => {
  it('journals before unlock, relocks before preview, verifies edits and relocks again', async () => {
    const f = fixture();
    await f.service.run([f.item]);
    expect(f.events).toEqual(['journal','unlock','lock','clear','preview','journal','unlock','edit','lock','clear']);
    expect(f.isLocked()).toBe(true);
    expect(f.info.timestamp).toBe(Date.parse('2017-05-04T12:34:56Z'));
    expect(f.records.size).toBe(0);
  });
  it('does not unlock if recovery storage fails', async () => {
    const f = fixture(); f.storage.setItem.mockImplementation(() => {throw new Error('quota');});
    await expect(f.service.run([f.item])).rejects.toThrow('quota');
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
  it('recovers a committed unlock whose response was lost', async () => {
    const f = fixture();
    f.api.removeFromLockedFolder.mockImplementation(() => {f.unlocked(); return Promise.reject(new Error('lost response'));});
    await expect(f.service.run([f.item])).rejects.toThrow('lost response');
    expect(f.isLocked()).toBe(true);
    expect(f.records.size).toBe(0);
  });
  it('relocks after metadata failure', async () => {
    const f = fixture(); f.api.getItemInfoExt.mockRejectedValue(new Error('cannot read'));
    await expect(f.service.run([f.item])).rejects.toThrow('cannot read');
    expect(f.isLocked()).toBe(true);
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
  });
  it('relocks on Stop and does not show a preview or edit', async () => {
    const f = fixture(); f.api.getItemInfoExt.mockImplementation(() => {f.stop(); return Promise.resolve({...f.info});});
    await f.service.run([f.item]);
    expect(f.isLocked()).toBe(true);
    expect(f.preview).not.toHaveBeenCalled();
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
  });
  it('cancels while all photos are locked', async () => {
    const f = fixture(); f.preview.mockResolvedValue([]);
    await f.service.run([f.item]);
    expect(f.api.removeFromLockedFolder).toHaveBeenCalledTimes(1);
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
    expect(f.isLocked()).toBe(true);
  });
  it('relocks on edit failure', async () => {
    const f = fixture(); f.api.setItemsTimestamp.mockRejectedValue(new Error('edit failed'));
    await expect(f.service.run([f.item])).rejects.toThrow('edit failed');
    expect(f.isLocked()).toBe(true);
  });
  it('retains recovery and stops before a second photo when restoration fails', async () => {
    const f = fixture(); f.api.moveToLockedFolder.mockRejectedValue(new Error('offline'));
    await expect(f.service.run([f.item,{...f.item,dedupKey:'other'}])).rejects.toThrow('not confirmed');
    expect(f.api.removeFromLockedFolder).toHaveBeenCalledTimes(1);
    expect(readRepairRecovery(f.storage,f.account)?.dedupKey).toBe('dedup');
    expect(f.preview).not.toHaveBeenCalled();
  });
  it('recovers after reload without editing or depending on the item still being listed as locked', async () => {
    const f = fixture(); f.unlocked(); f.stop();
    f.records.set(recoveryKey(f.account), JSON.stringify({version:1,account:f.account,...f.item}));
    await f.service.recover();
    expect(f.isLocked()).toBe(true);
    expect(f.records.size).toBe(0);
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
  });
  it('does not trust a successful lock response without membership verification', async () => {
    const f = fixture(); f.api.moveToLockedFolder.mockResolvedValue([]);
    await expect(f.service.run([f.item])).rejects.toThrow('not confirmed');
    expect(f.records.size).toBe(1);
  });
  it('clears recovery when a lost lock response nevertheless restored membership', async () => {
    const f=fixture();
    const lock=f.api.moveToLockedFolder.getMockImplementation()!;
    f.api.moveToLockedFolder.mockImplementation(() => {void lock(); return Promise.reject(new Error('lost reply'));});
    await f.service.run([f.item]);
    expect(f.isLocked()).toBe(true);
    expect(f.records.size).toBe(0);
  });
  it('does not count an unverified date response as a successful repair', async () => {
    const f = fixture(); f.api.setItemsTimestamp.mockResolvedValue([]);
    await expect(f.service.run([f.item])).rejects.toThrow('verify the updated date');
    expect(f.isLocked()).toBe(true);
  });
  it('rejects stale preview plans and relocks', async () => {
    const f = fixture(); f.preview.mockImplementation(plans => {f.info.fileName='changed.jpg'; return Promise.resolve(plans);});
    await expect(f.service.run([f.item])).rejects.toThrow('changed since preview');
    expect(f.api.setItemsTimestamp).not.toHaveBeenCalled();
    expect(f.isLocked()).toBe(true);
  });
  it('skips unknown filenames and missing offsets, returning each photo', async () => {
    const f = fixture(); f.info.fileName='Snapchat-421429335.jpg';
    await f.service.run([f.item]);
    f.info.fileName='2017-05-04.jpg'; f.info.timezoneOffset=undefined;
    await f.service.run([f.item]);
    expect(f.preview).not.toHaveBeenCalled(); expect(f.isLocked()).toBe(true);
  });
  it('fails closed on a malformed recovery record', async () => {
    const f = fixture(); f.records.set(recoveryKey(f.account),'{}');
    await expect(f.service.run([f.item])).rejects.toThrow('Invalid Locked Folder recovery');
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
  it('refuses to mutate after an account switch', async () => {
    const f = fixture(); f.assertAccount.mockImplementation(() => {throw new Error('account changed');});
    await expect(f.service.run([f.item])).rejects.toThrow('account changed');
    expect(f.api.removeFromLockedFolder).not.toHaveBeenCalled();
  });
  it('does not clear recovery if a folder page cannot be verified', async () => {
    const f = fixture(); f.records.set(recoveryKey(f.account),JSON.stringify({version:1,account:f.account,...f.item}));
    f.api.getLockedFolderItems.mockRejectedValue(new Error('offline'));
    await expect(f.service.recover()).rejects.toThrow('offline');
    expect(f.records.size).toBe(1);
  });
  it('verifies membership beyond the first page during recovery', async () => {
    const f=fixture();
    f.records.set(recoveryKey(f.account),JSON.stringify({version:1,account:f.account,...f.item}));
    f.api.getLockedFolderItems.mockResolvedValueOnce({items:[],nextPageId:'second'}).mockResolvedValueOnce({items:[f.item]});
    await f.service.recover();
    expect(f.api.getLockedFolderItems).toHaveBeenNthCalledWith(2,'second');
    expect(f.records.size).toBe(0);
  });
  it('refuses to clear recovery on a repeated pagination token', async () => {
    const f=fixture();
    f.records.set(recoveryKey(f.account),JSON.stringify({version:1,account:f.account,...f.item}));
    f.api.getLockedFolderItems.mockResolvedValue({items:[],nextPageId:'repeated'});
    await expect(f.service.recover()).rejects.toThrow('repeated page token');
    expect(f.records.size).toBe(1);
  });
  it('refuses overlapping repairs in another tab', async () => {
    vi.stubGlobal('navigator',{locks:{request: (_name: string,_opts: unknown, callback: (lock: null) => Promise<unknown>) => callback(null)}});
    const action=vi.fn();
    await expect(exclusiveLockedRepair('account',action)).rejects.toThrow('Another tab');
    expect(action).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
});
