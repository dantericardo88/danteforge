export function createStore() {
  return { todos: [], nextId: 1 };
}

export function addTodo(store, text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Todo text must not be empty');
  }

  const todo = {
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

export function listTodos(store, filter = 'all') {
  switch (filter) {
    case 'done':
      return store.todos.filter((todo) => todo.done);
    case 'pending':
      return store.todos.filter((todo) => !todo.done);
    default:
      return [...store.todos];
  }
}

export function completeTodo(store, id) {
  let found = false;

  const todos = store.todos.map((todo) => {
    if (todo.id !== id) return todo;
    found = true;
    return { ...todo, done: true };
  });

  return { store: { ...store, todos }, found };
}

export function deleteTodo(store, id) {
  const todos = store.todos.filter((todo) => todo.id !== id);
  return {
    store: { ...store, todos },
    found: todos.length !== store.todos.length,
  };
}

export function clearCompleted(store) {
  const todos = store.todos.filter((todo) => !todo.done);
  return {
    store: { ...store, todos },
    count: store.todos.length - todos.length,
  };
}

export function formatTodo(todo) {
  return `${String(todo.id).padStart(3)}  ${todo.done ? '[x]' : '[ ]'}  ${todo.text}`;
}
