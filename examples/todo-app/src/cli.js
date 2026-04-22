#!/usr/bin/env node

import { loadStore, saveStore } from './storage.js';
import {
  addTodo,
  clearCompleted,
  completeTodo,
  deleteTodo,
  formatTodo,
  listTodos,
} from './todo.js';

const [, , command, ...args] = process.argv;

async function main() {
  const store = await loadStore();

  switch (command) {
    case 'add': {
      const text = args.join(' ');
      if (!text.trim()) {
        fail('Usage: todo add <text>');
        return;
      }

      const { store: nextStore, todo } = addTodo(store, text);
      await saveStore(nextStore);
      console.log(`Added #${todo.id}: ${todo.text}`);
      return;
    }

    case 'list': {
      const filter = parseListFilter(args[0]);
      if (args[0] && !filter) {
        fail('Usage: todo list [all|pending|done]');
        return;
      }

      const todos = listTodos(store, filter ?? 'all');
      if (todos.length === 0) {
        console.log('No todos yet. Add one with: todo add <text>');
        return;
      }

      console.log('ID   Status  Text');
      console.log('---  ------  ----');
      for (const todo of todos) {
        console.log(formatTodo(todo));
      }
      return;
    }

    case 'done': {
      const id = parseId(args[0]);
      if (id === null) {
        fail('Usage: todo done <id>');
        return;
      }

      const { store: nextStore, found } = completeTodo(store, id);
      if (!found) {
        fail(`No todo with ID ${id}`);
        return;
      }

      await saveStore(nextStore);
      console.log(`Marked #${id} as done`);
      return;
    }

    case 'delete': {
      const id = parseId(args[0]);
      if (id === null) {
        fail('Usage: todo delete <id>');
        return;
      }

      const { store: nextStore, found } = deleteTodo(store, id);
      if (!found) {
        fail(`No todo with ID ${id}`);
        return;
      }

      await saveStore(nextStore);
      console.log(`Deleted #${id}`);
      return;
    }

    case 'clear': {
      const { store: nextStore, count } = clearCompleted(store);
      await saveStore(nextStore);
      console.log(`Cleared ${count} completed todo${count === 1 ? '' : 's'}`);
      return;
    }

    default:
      console.log('Usage: todo <command> [args]');
      console.log('');
      console.log('Commands:');
      console.log('  add <text>               Add a new todo');
      console.log('  list [all|pending|done]  List todos');
      console.log('  done <id>                Mark a todo as complete');
      console.log('  delete <id>              Remove a todo');
      console.log('  clear                    Remove all completed todos');
  }
}

function parseId(raw) {
  const id = Number.parseInt(raw ?? '', 10);
  return Number.isNaN(id) ? null : id;
}

function parseListFilter(raw) {
  if (!raw) return 'all';
  return ['all', 'pending', 'done'].includes(raw) ? raw : null;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
