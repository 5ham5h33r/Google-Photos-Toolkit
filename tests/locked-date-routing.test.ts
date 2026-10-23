import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
vi.mock('../src/windowGlobalData', () => ({windowGlobalData:{account:'test@example.invalid'}}));
vi.mock('../src/utils/getFromStorage', () => ({default:vi.fn(() => null)}));
vi.mock('../src/ui/logic/log', () => ({default:vi.fn()}));
import Core from '../src/gptk-core';
import ApiUtils from '../src/api/api-utils';
import {LockedDateRepair, recoveryKey} from '../src/locked-date-repair';
import log from '../src/ui/logic/log';

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
  it('defaults to opening only the first photo, even with a large source selection', async () => {
    const run=vi.spyOn(LockedDateRepair.prototype,'run').mockResolvedValue();
    const core=new Core();
    const other={...item,mediaKey:'other',dedupKey:'other'};
    await core.executeAction({elementId:'repairLockedDates'},{source:'lockedFolder',mediaItems:[item,other],preserveOrder:false});
    expect(run).toHaveBeenCalledWith([item]);
  });
  it('passes an explicit valid run limit through to the repair selection', async () => {
    const run=vi.spyOn(LockedDateRepair.prototype,'run').mockResolvedValue();
    const core=new Core();
    const other={...item,mediaKey:'other',dedupKey:'other'};
    await core.executeAction({elementId:'repairLockedDates'},{source:'lockedFolder',mediaItems:[item,other],maxRepairItems:2,preserveOrder:false});
    expect(run).toHaveBeenCalledWith([item,other]);
  });
  it('logs the cap rather than claiming that all matched items will be processed', async () => {
    vi.spyOn(LockedDateRepair.prototype,'run').mockResolvedValue();
    const core=new Core();
    await core.executeAction({elementId:'repairLockedDates'},{source:'lockedFolder',mediaItems:[item,{...item,dedupKey:'other'}],preserveOrder:false});
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Matched 2 items; inspecting at most 1'));
  });
  it('recovery ignores invalid filters and never scans', async () => {
    const recover=vi.spyOn(LockedDateRepair.prototype,'recover').mockResolvedValue();
    const core=new Core();
    const scan=vi.spyOn(LockedDateRepair.prototype,'scan');
    await core.actionWithFilter({elementId:'recoverLockedDates'},{fileNameRegex:'[',lockedDateRepairLimit:'0',minDuration:'-3'},'lockedFolder');
    expect(recover).toHaveBeenCalledTimes(1);
    expect(scan).not.toHaveBeenCalled();
  });
  it('does not use a partially successful generic scan for repair', async () => {
    const scan=vi.spyOn(LockedDateRepair.prototype,'scan').mockRejectedValue(new Error('second page failed'));
    const run=vi.spyOn(LockedDateRepair.prototype,'run').mockResolvedValue();
    const core=new Core();
    await core.actionWithFilter({elementId:'repairLockedDates'},{},'lockedFolder');
    expect(scan).toHaveBeenCalledTimes(1); expect(run).not.toHaveBeenCalled();
    expect(core.isProcessRunning).toBe(false);
  });
  it('refuses an unsupported metadata filter before any scan or unlock', async () => {
    const scan=vi.spyOn(LockedDateRepair.prototype,'scan');
    const core=new Core();
    await core.actionWithFilter({elementId:'repairLockedDates'},{fileNameRegex:'jpg'},'lockedFolder');
    expect(scan).not.toHaveBeenCalled();
  });
  it('blocks another action while a stopped action is still cleaning up', async () => {
    const core=new Core();
    let finish!: () => void;
    const run=vi.spyOn(LockedDateRepair.prototype,'run').mockImplementation(() => new Promise<void>(resolve => {finish=resolve;}));
    vi.spyOn(LockedDateRepair.prototype,'scan').mockResolvedValue([item]);
    const pending=core.actionWithFilter({elementId:'repairLockedDates'},{},'lockedFolder');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    core.isProcessRunning=false;
    expect(core.isActionInFlight).toBe(true);
    await core.actionWithFilter({elementId:'repairLockedDates'},{},'lockedFolder');
    expect(run).toHaveBeenCalledTimes(1);
    finish(); await pending;
    expect(core.isActionInFlight).toBe(false);
  });
});
