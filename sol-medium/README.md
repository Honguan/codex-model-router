# Task Tracker CLI

Task Tracker CLI is a small, dependency-free command-line application for creating, listing, completing, removing, and summarizing tasks. It requires Node.js 18 or newer and uses only Node.js built-in modules.

## Setup

Clone or copy the project, then run commands from its root directory. No package installation, external dependency, database, or build step is required.

```text
node src/cli.js add --title "Buy milk"
```

## Commands

Add a task (titles are trimmed and may contain up to 120 characters):

```text
node src/cli.js add --title "Buy milk"
node src/cli.js add --title="Buy milk"
```

List tasks. Valid statuses are `all`, `pending`, and `completed`; the default is `all`.

```text
node src/cli.js list
node src/cli.js list --status pending
node src/cli.js list --status=completed
```

Complete or remove a task by its positive integer ID:

```text
node src/cli.js done 1
node src/cli.js remove 1
```

Show statistics:

```text
node src/cli.js stats
```

## Storage and errors

Normal use stores a human-readable JSON task array in `.data/tasks.json`. `.data/metadata.json` stores only the next ID so removed IDs are not reused across process restarts. The directory and files are created automatically when the first mutation needs them. Tests can override the directory with `TASK_TRACKER_DATA_DIR`; normal commands default to `.data` under the current working directory.

Missing storage represents an empty task list. Empty files, malformed JSON, non-array task data, invalid task objects, and invalid metadata are reported as errors and are never silently reset or overwritten. Successful output goes to stdout with exit code 0. User, storage, and unexpected failures produce one concise message on stderr and a nonzero exit code.

Writes serialize complete, indented JSON with a trailing newline into a collision-resistant temporary file in the destination directory. The temporary file is closed before atomic replacement is attempted, and normal failures trigger temporary-file cleanup without first modifying the destination. This protects readers from partial destination JSON during a single writer's replacement; it is not a disk-durability guarantee.

There is no cross-process lock. Each mutation performs a fresh read-modify-write flow, but truly simultaneous writers can still overwrite one another's task changes or reserve the same ID. Use one mutating process at a time when updates must not be lost.

## Tests

Run the complete isolated test suite with:

```text
npm test
```

Tests use temporary directories and do not access the project's normal `.data` directory.

## Project structure

```text
src/cli.js           command dispatch and process I/O
src/arguments.js     command-line parsing and argument validation
src/task-service.js  task business rules and state transitions
src/task-store.js    stored-data validation and atomic persistence
src/errors.js        expected application error classification
test/                isolated end-to-end tests
```

## Example workflow

```text
> node src/cli.js add --title "Buy milk"
Created task 1: Buy milk
> node src/cli.js add --title "Call Sam"
Created task 2: Call Sam
> node src/cli.js list
[ ] 1 Buy milk
[ ] 2 Call Sam
> node src/cli.js done 1
Completed task 1: Buy milk
> node src/cli.js list --status completed
[x] 1 Buy milk
> node src/cli.js stats
Total: 2
Pending: 1
Completed: 1
Completion rate: 50%
> node src/cli.js remove 2
Removed task 2: Call Sam
```
