#!/usr/bin/env node
// Thin CLI dispatcher — all business logic lives in todo.ts.

import { addTodo, listTodos, completeTodo, deleteTodo, clearCompleted, formatTodo } from './todo.js';
import { loadStore, saveStore } from './storage.js';

const [, , command, ...args] = process.argv;

async function main(): Promise<void> {
  const store = await loadStore();

  switch (command) {
    case 'add': {
      const text = args.join(' ');
      if (!text.trim()) {
        console.error('Usage: todo add <text>');
        process.exitCode = 1;
        return;
      }
      const { store: next, todo } = addTodo(store, text);
      await saveStore(next);
      console.log(`Added #${todo.id}: ${todo.text}`);
      break;
    }

    case 'list': {
      const todos = listTodos(store);
      if (todos.length === 0) {
        console.log('No todos yet. Add one with: todo add <text>');
        return;
      }
      console.log('ID   Status  Text');
      console.log('---  ------  ----');
      for (const t of todos) {
        console.log(formatTodo(t));
      }
      break;
    }

    case 'done': {
      const id = parseInt(args[0] ?? '', 10);
      if (isNaN(id)) {
        console.error('Usage: todo done <id>');
        process.exitCode = 1;
        return;
      }
      const { store: next, found } = completeTodo(store, id);
      if (!found) {
        console.error(`No todo with ID ${id}`);
        process.exitCode = 1;
        return;
      }
      await saveStore(next);
      console.log(`Marked #${id} as done`);
      break;
    }

    case 'delete': {
      const id = parseInt(args[0] ?? '', 10);
      if (isNaN(id)) {
        console.error('Usage: todo delete <id>');
        process.exitCode = 1;
        return;
      }
      const { store: next, found } = deleteTodo(store, id);
      if (!found) {
        console.error(`No todo with ID ${id}`);
        process.exitCode = 1;
        return;
      }
      await saveStore(next);
      console.log(`Deleted #${id}`);
      break;
    }

    case 'clear': {
      const { store: next, count } = clearCompleted(store);
      await saveStore(next);
      console.log(`Cleared ${count} completed todo${count === 1 ? '' : 's'}`);
      break;
    }

    default: {
      console.log('Usage: todo <command> [args]');
      console.log('');
      console.log('Commands:');
      console.log('  add <text>   Add a new todo');
      console.log('  list         List all todos');
      console.log('  done <id>    Mark a todo as complete');
      console.log('  delete <id>  Remove a todo');
      console.log('  clear        Remove all completed todos');
      break;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
