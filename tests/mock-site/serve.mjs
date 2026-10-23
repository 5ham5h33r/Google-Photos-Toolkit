import http from 'node:http';
import fs from 'node:fs/promises';
const root=new URL('./',import.meta.url);
const routes=new Map([
  ['/lockedfolder',new URL('index.html',root)],
  ['/mock-api.js',new URL('mock-api.js',root)],
  ['/bundle.js',new URL('../../google_photos_toolkit.user.js',root)],
]);
http.createServer(async(req,res)=>{
  const file=routes.get(new URL(req.url,'http://localhost').pathname);
  if(!file){res.writeHead(404);res.end();return;}
  try {
    const bytes=await fs.readFile(file);
    res.writeHead(200,{
      'Content-Type':file.pathname.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8',
      'Cache-Control':'no-store',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'",
    });res.end(bytes);
  }catch{res.writeHead(500);res.end('Build the production userscript first.');}
}).listen(8766,'127.0.0.1',()=>console.log('Local mock site: http://127.0.0.1:8766/lockedfolder'));
