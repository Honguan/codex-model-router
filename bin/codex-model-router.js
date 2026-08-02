#!/usr/bin/env node
import { runCli } from "../lib/cli-v2.js";

process.exitCode = await runCli(process.argv.slice(2), { output: console.log });
