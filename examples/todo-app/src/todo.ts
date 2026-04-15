// Pure-function todo CRUD — no I/O, no side effects.
// All state is passed in and returned; callers own persistence.

export interface Todo {
  id: number;
  text: string;
  done: boolean;
  createdAt: string; // ISO 8601
}

export interface TodoStore {
  todos: Todo[];
  nextId: number;
}

export interface AddResult {
  store: TodoStore;
  todo: Todo;
}

export interface MutateResult {
  store: TodoStore;
  found: boolean;
}

export interface ClearResult {
  store: TodoStore;
  count: number;
}

/** Create a fresh empty store. */
export function createStore(): TodoStore {
  return { todos: [], nextId: 1 };
}

/** Add a new todo item. Returns updated store and the new todo. */
export function addTodo(store: TodoStore, text: string): AddResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error('Todo text must not be empty');
  }
  const todo: Todo = {
    id: store.nextId,
    text: trimmed,
    done: false,
    createdAt: new Date().toISOString(),
  };
  return {
    store: {
      todos: [...store.todos, todo],
      nextId: store.nextId + 1,
    },
    todo,
  };
}

/** Return all todos, optionally filtered. */
export function listTodos(store: TodoStore, filter?: 'all' | 'done' | 'pending'): Todo[] {
  switch (filter) {
    case 'done':
      return store.todos.filter((t) => t.done);
    case 'pending':
      return store.todos.filter((t) => !t.done);
    default:
      return [...store.todos];
  }
}

/** Mark a todo as completed by ID. */
export function completeTodo(store: TodoStore, id: number): MutateResult {
  let found = false;
  const todos = store.todos.map((t) => {
    if (t.id === id) {
      found = true;
      return { ...t, done: true };
    }
    return t;
  });
  return { store: { ...store, todos }, found };
}

/** Delete a todo by ID. */
export function deleteTodo(store: TodoStore, id: number): MutateResult {
  const before = store.todos.length;
  const todos = store.todos.filter((t) => t.id !== id);
  const found = todos.length < before;
  return { store: { ...store, todos }, found };
}

/** Remove all completed todos. Returns count removed. */
export function clearCompleted(store: TodoStore): ClearResult {
  const pending = store.todos.filter((t) => !t.done);
  const count = store.todos.length - pending.length;
  return { store: { ...store, todos: pending }, count };
}

/** Format a single todo for display. */
export function formatTodo(todo: Todo): string {
  const status = todo.done ? '[x]' : '[ ]';
  return `${String(todo.id).padStart(3)}  ${status}  ${todo.text}`;
}
