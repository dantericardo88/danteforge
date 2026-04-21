import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  addTodo,
  clearCompleted,
  completeTodo,
  createStore,
  deleteTodo,
  listTodos,
} from '../src/todo.js';
import { loadStore, saveStore } from '../src/storage.js';

const tempPaths = [];

after(async () => {
  await Promise.all(tempPaths.map((target) => fs.rm(target, { recursive: true, force: true })));
});

describe('todo store helpers', () => {
  it('createStore starts empty with nextId=1', () => {
    assert.deepEqual(createStore(), { todos: [], nextId: 1 });
  });

  it('addTodo trims text, increments ids, and leaves the original store untouched', () => {
    const store = createStore();
    const first = addTodo(store, '  Buy groceries  ');
    const second = addTodo(first.store, 'Write tests');

    assert.equal(first.todo.id, 1);
    assert.equal(first.todo.text, 'Buy groceries');
    assert.equal(second.todo.id, 2);
    assert.equal(store.todos.length, 0);
    assert.equal(store.nextId, 1);
  });

  it('rejects empty todo text', () => {
    assert.throws(() => addTodo(createStore(), '   '), /empty/i);
  });

  it('filters todos by status', () => {
    let store = createStore();
    store = addTodo(store, 'Pending task').store;
    store = addTodo(store, 'Done task').store;
    store = completeTodo(store, 2).store;

    assert.equal(listTodos(store).length, 2);
    assert.equal(listTodos(store, 'pending').length, 1);
    assert.equal(listTodos(store, 'done').length, 1);
    assert.equal(listTodos(store, 'done')[0].text, 'Done task');
  });

  it('completes, deletes, and clears todos without mutating prior state', () => {
    let store = createStore();
    store = addTodo(store, 'Keep me').store;
    store = addTodo(store, 'Remove me').store;

    const completed = completeTodo(store, 2);
    const deleted = deleteTodo(completed.store, 1);
    const cleared = clearCompleted(completed.store);

    assert.equal(completed.found, true);
    assert.equal(store.todos[1].done, false);
    assert.equal(deleted.found, true);
    assert.equal(deleted.store.todos.length, 1);
    assert.equal(cleared.count, 1);
    assert.equal(cleared.store.todos.length, 1);
    assert.equal(cleared.store.todos[0].text, 'Keep me');
  });
});

describe('storage', () => {
  it('returns an empty store when the file is missing', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-todo-empty-'));
    tempPaths.push(baseDir);
    const target = path.join(baseDir, 'todos.json');

    assert.deepEqual(await loadStore(target), createStore());
  });

  it('persists and reloads todos', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-todo-save-'));
    tempPaths.push(baseDir);
    const target = path.join(baseDir, 'todos.json');
    const { store } = addTodo(createStore(), 'Ship the example');

    await saveStore(store, target);

    assert.deepEqual(await loadStore(target), store);
  });

  it('raises a helpful error for corrupt JSON', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-todo-corrupt-'));
    tempPaths.push(baseDir);
    const target = path.join(baseDir, 'todos.json');
    await fs.writeFile(target, '{ nope', 'utf8');

    await assert.rejects(loadStore(target), /Delete the file to reset/i);
  });
});
