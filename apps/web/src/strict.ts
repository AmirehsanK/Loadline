import { z } from 'zod';

// The pages are served with a content security policy that forbids turning text into code. The
// schema library would otherwise test whether it may by trying, which the browser reports as a
// violation every time the page loads. Telling it not to costs a little speed on parsing, which
// is nothing at the size of a design.
//
// This has to run before any schema is used, so it is the first import of every entry point.
z.config({ jitless: true });
