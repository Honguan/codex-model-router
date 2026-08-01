# Task Tracker CLI

Task Tracker CLI is a small local command-line application for creating, listing, completing, removing, and summarizing tasks.

## Requirements and setup

- Node.js 18 or newer.
- No external dependencies are required.

From the project directory, run:

```bash
npm test
```

The CLI has no build step.

## Commands

Create a task:

```bash
node src/cli.js add --title "Buy milk"
node src/cli.js add --title="Buy milk"
```

List tasks, optionally filtering by `pending`, `completed`, or `all`:

```bash
node src/cli.js list
node src/cli.js list --status pending
node src/cli.js list --status=completed
```

Complete or remove a task by positive integer ID:

```bash
node src/cli.js done 1
node src/cli.js remove 1
```

Show statistics:

```bash
node src/cli.js stats
```

Successful output goes to standard output. Expected errors go to standard error and return a nonzero exit code. Unknown commands, unsupported or duplicate options, missing values, invalid IDs, invalid statuses, invalid titles, corrupted data, and failed file operations are errors.

## Storage

By default, tasks are stored in `.data/tasks.json` under the current working directory. The `.data` directory and files are created automatically when a mutation needs them. The task file is a human-readable UTF-8 JSON array with two-space indentation and a trailing newline.

The `.data/id-sequence.json` metadata file stores the next ID to assign. It preserves monotonically increasing IDs after tasks are removed and across separate CLI processes. Both files are validated when loaded. Empty or malformed JSON, non-array task data, invalid task objects, and invalid metadata are rejected without resetting or replacing the original content.

Tests can select an isolated data directory with the `TASK_TRACKER_DATA_DIR` environment variable. Normal usage does not read task data from the user's home directory.

Each mutation loads current data immediately before its read-modify-write flow. Writes use a collision-resistant temporary file in the destination directory, close it, and then replace the destination. This protects each destination from incomplete JSON during ordinary write failures. There is no distributed lock, so simultaneous writers can still race and lose updates; atomic replacement does not prevent that limitation.

## Project structure

```text
src/arguments.js     command-line parsing and validation
src/cli.js           entry point and command dispatch
src/errors.js        expected application error type
src/task-service.js  task rules, state transitions, statistics, and formatting
src/task-store.js    JSON storage, validation, ID metadata, and atomic writes
test/                isolated CLI and storage tests
```

## Example workflow

```bash
node src/cli.js add --title "Buy milk"
Created task 1: Buy milk
node src/cli.js add --title "Write report"
Created task 2: Write report
node src/cli.js list
[ ] 1 Buy milk
[ ] 2 Write report
node src/cli.js done 1
Completed task 1: Buy milk
node src/cli.js stats
Total: 2
Pending: 1
Completed: 1
Completion rate: 50%
node src/cli.js remove 2
Removed task 2: Write report
```
