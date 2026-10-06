/* global document, fetch, location, navigator -- this file runs in the page */

import { RUNS } from './hashes.js';

// Makes every run and posts the hashes back to the server that served this page. There is nothing
// to look at; the list on the page is for someone who opens it by hand to see what happened.

const list = document.querySelector('#runs');
const answer = { agent: navigator.userAgent, hashes: {} };
try {
  for (const [name, hash] of RUNS) {
    answer.hashes[name] = hash();
    list.textContent += `${answer.hashes[name]}  ${name}\n`;
  }
} catch (error) {
  answer.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  list.textContent += `${answer.error}\n`;
}
await fetch(`/report${location.search}`, { method: 'POST', body: JSON.stringify(answer) });
