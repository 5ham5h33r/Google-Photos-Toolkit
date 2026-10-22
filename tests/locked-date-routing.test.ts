import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
vi.mock('../src/windowGlobalData', () => ({windowGlobalData:{account:'test@example.invalid'}}));
vi.mock('../src/utils/getFromStorage', () => ({default:vi.fn(() => null)}));
import Core from '../src/gptk-core';
import ApiUtils from '../src/api/api-utils';
import {LockedDateRepair, recoveryKey} from '../src/locked-date-repair';

const item={mediaKey:'media',dedupKey:'dedup',timestamp:0,creationTimestamp:0};
let records: Map<string,string>;
beforeEach(() => {
  records=new Map();
  vi.stubGlobal('localStorage',{
    getItem:(key:string) => records.get(key) ?? null,
    setItem:(key:string,value:string) => records.set(key,value),
    removeItem:(key:string) => records.delete(key),
  });
  vi.stubGlobal('navigator',{locks:{request:(_name:string,_opts:unknown,fn:(lock:object) => Promise<unknown>) => fn({})}});
  vi.stubGlobal('document',{dispatchEvent:vi.fn()});
});
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('Locked Folder action dispatch', () => {
  it.each(['setDateFromFilename','exportMetadata','toFavorite','lock'])('rejects %s instead of turning it into Unlock', async elementId => {
    const core=new Core();
    const unlock=vi.spyOn(ApiUtils.prototype,'removeFromLockedFolder');
    await expect(core.executeAction({elementId},{source:'lockedFolder',mediaItems:[item],preserveOrder:false})).rejects.toThrow('unavailable');
    expect(unlock).not.toHaveBeenCalled();
  });
  it('dispatches the explicit repair action to the repair service', async () => {
    const run=vi.spyOn(LockedDateRepair.prototype,'run').mockResolvedValue();
    const core=new Core();
    await core.executeAction({elementId:'repairLockedDates'},{source:'lockedFolder',mediaItems:[item],preserveOrder:false});
    expect(run).toHaveBeenCalledWith([item]);
  });
  it('runs recovery before selection, even when no locked items remain', async () => {
    const recover=vi.spyOn(LockedDateRepair.prototype,'recover').mockResolvedValue();
    const core=new Core();
    const scan=vi.spyOn(core,'getAndFilterMedia');
    await core.actionWithFilter({elementId:'recoverLockedDates'},{},'lockedFolder');
    expect(recover).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
  });
  it('blocks unrelated actions while recovery is pending', async () => {
    records.set(recoveryKey('test@example.invalid'),JSON.stringify({version:1,account:'test@example.invalid',...item}));
    const core=new Core();
    await expect(core.executeAction({elementId:'toFavorite'},{source:'library',mediaItems:[item],preserveOrder:false})).rejects.toThrow('recovery is pending');
  });
  it('requires the Locked source for the repair action', async () => {
    const core=new Core();
    await expect(core.executeAction({elementId:'repairLockedDates'},{source:'library',mediaItems:[item],preserveOrder:false})).rejects.toThrow('Locked source');
  });
});
