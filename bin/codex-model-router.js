#!/usr/bin/env node
import { runCli } from "../lib/enhanced-cli.js";

process.exitCode = await runCli(process.argv.slice(2), { output: console.log });
