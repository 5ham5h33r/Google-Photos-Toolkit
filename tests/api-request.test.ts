import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../src/windowGlobalData',()=>({windowGlobalData:{account:'test',at:'mock',path:'/',bl:'mock','f.sid':'mock'}}));
import Api from '../src/api/api';

const envelope=(id:string,payload:unknown)=>['wrb.fr',id,JSON.stringify(payload)];
const response=(entries:unknown[])=>({ok:true,text:()=>Promise.resolve(")]}'\n"+JSON.stringify(entries))});
beforeEach(()=>{
  vi.useFakeTimers();
  vi.stubGlobal('window',{location:{pathname:'/lockedfolder'}});
  vi.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('RPC transport used by Locked Folder repair',()=>{
  it('uses the matching RPC envelope even if a different result comes first',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response([envelope('other',['wrong']),envelope('target',['right'])])));
    expect(await new Api().makeApiRequest('target',[])).toEqual(['right']);
  });
  it('finds a matching envelope on a later line and accepts a JSON null payload',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,text:()=>Promise.resolve(JSON.stringify([envelope('other',[])])+'\n'+JSON.stringify([envelope('target',null)]))}));
    expect(await new Api().makeApiRequest('target',[])).toBeNull();
  });
  it('reports the screenshot missing-payload failure after three bounded attempts',async()=>{
    const fetch=vi.fn().mockResolvedValue(response([['wrb.fr','fDcn4b',null]])); vi.stubGlobal('fetch',fetch);
    const result=expect(new Api(15000).makeApiRequest('fDcn4b',[])).rejects.toThrow('Missing payload in parsed response');
    await vi.runAllTimersAsync(); await result;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('never sends a retry after the account guard changes',async()=>{
    let originalAccount=true;
    const guard=vi.fn(()=>{if(!originalAccount) throw new Error('account changed');});
    const fetch=vi.fn(()=>{originalAccount=false;return Promise.reject(new Error('offline'));}); vi.stubGlobal('fetch',fetch);
    const result=expect(new Api(15000,guard).makeApiRequest('target',[])).rejects.toThrow('account changed');
    await vi.runAllTimersAsync(); await result;
    expect(fetch).toHaveBeenCalledTimes(1); expect(guard).toHaveBeenCalledTimes(2);
  });
  it('does not send a request when the initial account check fails',async()=>{
    const fetch=vi.fn(); vi.stubGlobal('fetch',fetch);
    await expect(new Api(15000,()=>{throw new Error('account changed');}).makeApiRequest('target',[])).rejects.toThrow('account changed');
    expect(fetch).not.toHaveBeenCalled();
  });
});
