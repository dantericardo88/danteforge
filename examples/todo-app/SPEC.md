# Spec: TODO CLI App

## Overview
A command-line TODO list manager. Users can add, list, complete, and delete tasks from the terminal.

## Commands

### `todo add <text>`
Add a new TODO item. Auto-assigns an incrementing ID. Prints confirmation with the assigned ID.

### `todo list`
Display all TODO items in a table format:
```
ID  Status  Text
1   [ ]     Buy groceries
2   [x]     Write tests
3   [ ]     Deploy app
```

### `todo done <id>`
Mark a TODO item as completed by ID. Prints confirmation or error if ID not found.

### `todo delete <id>`
Remove a TODO item by ID. Prints confirmation or error if ID not found.

### `todo clear`
Remove all completed items. Prints count of items cleared.

## Data Model
```typescript
interface Todo {
  id: number;
  text: string;
  done: boolean;
  createdAt: string; // ISO 8601
}

interface TodoStore {
  todos: Todo[];
  nextId: number;
}
```

## Storage
- File: `~/.todos.json`
- Format: JSON (pretty-printed for human readability)
- Created automatically on first use
- Atomic writes: write to temp file, then rename

## Error Handling
- Missing store file: create with empty state
- Invalid ID: print error message, exit code 1
- Corrupt JSON: print error, suggest `todo clear --force` to reset

## Testing Requirements
- Unit tests for all CRUD operations using in-memory store
- Integration test: add → list → done → list → delete → list cycle
- Edge cases: empty list, duplicate IDs, very long text
