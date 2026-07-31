#!/usr/bin/env node
import { run } from "../lib/router.js";

process.exitCode = await run(process.argv.slice(2), { output: console.log });
