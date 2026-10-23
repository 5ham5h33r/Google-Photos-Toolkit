import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const file=new URL('../google_photos_toolkit.user.js',import.meta.url);
const source=await fs.readFile(file,'utf8');
const end=source.indexOf('// ==/UserScript==');
if(end<0) throw new Error('Build the production userscript before creating the local test copy.');
let header=source.slice(0,end);
for(const [key,value] of Object.entries({
  name:'Google Photos Toolkit - Locked Dates TEST',
  version:'3.3.0.148.4',
  namespace:'https://github.com/5ham5h33r/Google-Photos-Toolkit/locked-dates-test',
  supportURL:'https://github.com/5ham5h33r/Google-Photos-Toolkit',
  downloadURL:'none',
  updateURL:'none',
})) {
  const line=`// @${key} ${value}\n`;
  const pattern=new RegExp(`^// @${key}\\s+.*(?:\\r?\\n|$)`,'m');
  header=pattern.test(header)?header.replace(pattern,line):header+line;
}
const output=process.argv[2]??'google_photos_toolkit.locked-dates-test.user.js';
const test=header+source.slice(end);
await fs.writeFile(output,test);
console.log(JSON.stringify({output,version:'3.3.0.148.4',sha256:createHash('sha256').update(test).digest('hex'),bytes:Buffer.byteLength(test)},null,2));
