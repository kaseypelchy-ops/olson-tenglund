#!/usr/bin/env node
// Add only this migration's journal entry, never rewrite earlier history.
import { readFile, writeFile } from 'node:fs/promises';
const name='drizzle/meta/_journal.json';
const journal=JSON.parse(await readFile(name,'utf8'));
const tag='0006_fitment_feed_staging';
const found=journal.entries.find(x=>x.tag===tag);
if(found){console.log('Journal already contains '+tag);process.exit(0);}
if(journal.entries.length!==6 || journal.entries.at(-1)?.idx!==5 || !journal.entries.at(-1)?.tag.startsWith('0005_')) {
 console.error('Expected existing migrations 0000 through 0005. Stop: do not overwrite migration history.');process.exit(1);
}
journal.entries.push({idx:6,version:'6',when:Date.now(),tag,breakpoints:true});
await writeFile(name,JSON.stringify(journal,null,2)+'\n');
console.log('Registered '+tag);
