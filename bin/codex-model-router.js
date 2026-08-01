#!/usr/bin/env node
import { runCli } from "../lib/agent-reasoning-cli.js";

process.exitCode = await runCli(process.argv.slice(2), { output: console.log });