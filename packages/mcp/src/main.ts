#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.ts';

// The entry point: an MCP server over standard input and output, for an agent that starts it as a
// child process. Nothing is printed to standard output but the protocol.

await createServer().connect(new StdioServerTransport());
