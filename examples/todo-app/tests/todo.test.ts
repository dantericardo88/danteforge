import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore,
  addTodo,
  listTodos,
  completeTodo,
  deleteTodo,
  clearCompleted,
  type TodoStore,
} from '../src/todo.js';

// ── createStore ───────────────────────────────────────────────────────────────

describe('createStore', () => {
  it('returns an empty store with nextId=1', () => {
    const store = createStore();
    assert.deepEqual(store, { todos: [], nextId: 1 });
  });
});

// ── addTodo ───────────────────────────────────────────────────────────────────

describe('addTodo', () => {
  it('adds a todo with the trimmed text and increments nextId', () => {
    const store = createStore();
    const { store: next, todo } = addTodo(store, '  Buy groceries  ');
    assert.equal(todo.id, 1);
    assert.equal(todo.text, 'Buy groceries');
    assert.equal(todo.done, false);
    assert.equal(next.nextId, 2);
    assert.equal(next.todos.length, 1);
    assert.ok(typeof todo.createdAt === 'string' && todo.createdAt.length > 0);
  });

  it('assigns sequential IDs across multiple adds', () => {
    let store = createStore();
    store = addTodo(store, 'First').store;
    store = addTodo(store, 'Second').store;
    const { todo } = addTodo(store, 'Third');
    assert.equal(todo.id, 3);
  });

  it('throws when text is empty or whitespace-only', () => {
    const store = createStore();
    assert.throws(() => addTodo(store, '   '), /empty/i);
    assert.throws(() => addTodo(store, ''), /empty/i);
  });

  it('does not mutate the original store', () => {
    const store = createStore();
    addTodo(store, 'Test');
    assert.equal(store.todos.length, 0);
    assert.equal(store.nextId, 1);
  });
});

// ── listTodos ─────────────────────────────────────────────────────────────────

describe('listTodos', () => {
  function makeStore(): TodoStore {
    let s = createStore();
    s = addTodo(s, 'Pending task').store;
    s = addTodo(s, 'Done task').store;
    s = completeTodo(s, 2).store;
    return s;
  }

  it('returns all todos when no filter is given', () => {
    const todos = listTodos(makeStore());
    assert.equal(todos.length, 2);
  });

  it('filters to only pending todos', () => {
    const todos = listTodos(makeStore(), 'pending');
    assert.equal(todos.length, 1);
    assert.equal(todos[0]!.text, 'Pending task');
  });

  it('filters to only done todos', () => {
    const todos = listTodos(makeStore(), 'done');
    assert.equal(todos.length, 1);
    assert.equal(todos[0]!.text, 'Done task');
  });

  it('returns empty array for an empty store', () => {
    assert.deepEqual(listTodos(createStore()), []);
  });
});

// ── completeTodo ──────────────────────────────────────────────────────────────

describe('completeTodo', () => {
  it('marks the matching todo as done', () => {
    let store = createStore();
    store = addTodo(store, 'Task').store;
    const { store: next, found } = completeTodo(store, 1);
    assert.equal(found, true);
    assert.equal(next.todos[0]!.done, true);
  });

  it('returns found=false for an unknown ID', () => {
    const { found } = completeTodo(createStore(), 99);
    assert.equal(found, false);
  });

  it('does not mutate the original store', () => {
    let store = createStore();
    store = addTodo(store, 'Task').store;
    completeTodo(store, 1);
    assert.equal(store.todos[0]!.done, false);
  });
});

// ── deleteTodo ────────────────────────────────────────────────────────────────

describe('deleteTodo', () => {
  it('removes the todo with the matching ID', () => {
    let store = createStore();
    store = addTodo(store, 'Task').store;
    const { store: next, found } = deleteTodo(store, 1);
    assert.equal(found, true);
    assert.equal(next.todos.length, 0);
  });

  it('returns found=false for an unknown ID', () => {
    const { found } = deleteTodo(createStore(), 99);
    assert.equal(found, false);
  });
});

// ── clearCompleted ────────────────────────────────────────────────────────────

describe('clearCompleted', () => {
  it('removes all done todos and returns the count', () => {
    let store = createStore();
    store = addTodo(store, 'Keep').store;
    store = addTodo(store, 'Remove').store;
    store = completeTodo(store, 2).store;
    const { store: next, count } = clearCompleted(store);
    assert.equal(count, 1);
    assert.equal(next.todos.length, 1);
    assert.equal(next.todos[0]!.text, 'Keep');
  });

  it('returns count=0 when nothing is done', () => {
    let store = createStore();
    store = addTodo(store, 'Pending').store;
    const { count } = clearCompleted(store);
    assert.equal(count, 0);
  });
});
