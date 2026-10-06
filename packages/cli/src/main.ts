#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { cli } from './cli.ts';

// The entry point: `node packages/cli/src/main.ts <command>`, or `npm run loadline -- <command>`.
// Node runs TypeScript as it is, so there is nothing to build first.

process.exitCode = await cli(process.argv.slice(2), {
  out: (text) => {
    console.log(text);
  },
  err: (text) => {
    console.error(text);
  },
  readFile: (path) => readFileSync(path, 'utf8'),
});
