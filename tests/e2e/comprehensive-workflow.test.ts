import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('Comprehensive E2E Tests', () => {
  it('should complete full workflow with oracle validation', async () => {
    const e2eDir = path.join(process.cwd(), 'test-comprehensive-workspace');
    await fs.mkdir(e2eDir, { recursive: true });

    try {
      // Initialize project
      execSync('node dist/index.js init --non-interactive', { cwd: e2eDir, stdio: 'pipe' });

      // Constitution
      execSync('node dist/index.js constitution', {
        cwd: e2eDir,
        stdio: 'pipe',
        input: 'Zero ambiguity in requirements\nProgressive enhancement approach\nAccessible by default\nPerformance-first development\n'
      });

      // Specify and plan
      execSync('node dist/index.js specify "Build a robust task management system"', { cwd: e2eDir, stdio: 'pipe' });
      execSync('node dist/index.js plan', { cwd: e2eDir, stdio: 'pipe' });
      execSync('node dist/index.js tasks', { cwd: e2eDir, stdio: 'pipe' });

      // Create comprehensive implementation
      await fs.writeFile(path.join(e2eDir, 'task-manager.js'), `
class TaskManager {
  constructor() {
    this.tasks = [];
    this.categories = new Set();
  }

  addTask(title, description = '', category = 'general', priority = 'medium') {
    const task = {
      id: Date.now(),
      title,
      description,
      category,
      priority,
      completed: false,
      createdAt: new Date().toISOString()
    };
    this.tasks.push(task);
    this.categories.add(category);
    return task.id;
  }

  completeTask(id) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.completed = true;
      task.completedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  deleteTask(id) {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      this.tasks.splice(index, 1);
      return true;
    }
    return false;
  }

  getTasks(filter = {}) {
    let filtered = [...this.tasks];

    if (filter.category) {
      filtered = filtered.filter(t => t.category === filter.category);
    }
    if (filter.completed !== undefined) {
      filtered = filtered.filter(t => t.completed === filter.completed);
    }
    if (filter.priority) {
      filtered = filtered.filter(t => t.priority === filter.priority);
    }

    return filtered;
  }

  getStats() {
    const total = this.tasks.length;
    const completed = this.tasks.filter(t => t.completed).length;
    const pending = total - completed;
    const categories = Array.from(this.categories);

    return { total, completed, pending, categories };
  }
}

module.exports = TaskManager;
      `);

      await fs.writeFile(path.join(e2eDir, 'index.html'), `
<!DOCTYPE html>
<html>
<head>
  <title>Task Manager</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .task { border: 1px solid #ccc; padding: 10px; margin: 5px 0; }
    .completed { text-decoration: line-through; color: #888; }
    .stats { background: #f0f0f0; padding: 10px; margin: 10px 0; }
  </style>
</head>
<body>
  <h1>Task Manager</h1>

  <div class="stats" id="stats"></div>

  <form id="taskForm">
    <input type="text" id="title" placeholder="Task title" required>
    <input type="text" id="description" placeholder="Description">
    <select id="category">
      <option value="general">General</option>
      <option value="work">Work</option>
      <option value="personal">Personal</option>
    </select>
    <select id="priority">
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
    </select>
    <button type="submit">Add Task</button>
  </form>

  <div id="taskList"></div>

  <script src="task-manager.js"></script>
  <script>
    const manager = new TaskManager();

    function updateStats() {
      const stats = manager.getStats();
      document.getElementById('stats').innerHTML =
        \`Total: \${stats.total} | Completed: \${stats.completed} | Pending: \${stats.pending} | Categories: \${stats.categories.join(', ')}\`;
    }

    function renderTasks() {
      const tasks = manager.getTasks();
      const taskList = document.getElementById('taskList');
      taskList.innerHTML = '';

      tasks.forEach(task => {
        const div = document.createElement('div');
        div.className = 'task ' + (task.completed ? 'completed' : '');
        div.innerHTML = \`
          <h3>\${task.title}</h3>
          <p>\${task.description}</p>
          <small>Category: \${task.category} | Priority: \${task.priority}</small>
          <div>
            \${!task.completed ? \`<button onclick="completeTask(\${task.id})">Complete</button>\` : ''}
            <button onclick="deleteTask(\${task.id})">Delete</button>
          </div>
        \`;
        taskList.appendChild(div);
      });
    }

    function completeTask(id) {
      manager.completeTask(id);
      renderTasks();
      updateStats();
    }

    function deleteTask(id) {
      manager.deleteTask(id);
      renderTasks();
      updateStats();
    }

    document.getElementById('taskForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const title = document.getElementById('title').value;
      const description = document.getElementById('description').value;
      const category = document.getElementById('category').value;
      const priority = document.getElementById('priority').value;

      manager.addTask(title, description, category, priority);

      document.getElementById('title').value = '';
      document.getElementById('description').value = '';

      renderTasks();
      updateStats();
    });

    // Initialize with sample data
    manager.addTask('Set up project', 'Initialize the task management system', 'work', 'high');
    manager.addTask('Design UI', 'Create user interface mockups', 'work', 'medium');
    manager.completeTask(manager.getTasks()[0].id);

    renderTasks();
    updateStats();
  </script>
</body>
</html>
      `);

      // Create comprehensive tests
      await fs.writeFile(path.join(e2eDir, 'test-comprehensive.js'), `
const TaskManager = require('./task-manager.js');
const assert = require('assert');

console.log('Running comprehensive tests...');

const manager = new TaskManager();

// Test adding tasks
const taskId1 = manager.addTask('Test Task 1', 'Description 1', 'work', 'high');
const taskId2 = manager.addTask('Test Task 2', 'Description 2', 'personal', 'low');

console.log('✓ Added tasks');

// Test getting tasks
const allTasks = manager.getTasks();
assert(allTasks.length === 2, 'Should have 2 tasks');

const workTasks = manager.getTasks({ category: 'work' });
assert(workTasks.length === 1, 'Should have 1 work task');

console.log('✓ Task filtering works');

// Test completing tasks
const completed = manager.completeTask(taskId1);
assert(completed === true, 'Should complete task');

const task1 = manager.getTasks().find(t => t.id === taskId1);
assert(task1.completed === true, 'Task should be completed');
assert(task1.completedAt, 'Should have completion timestamp');

console.log('✓ Task completion works');

// Test deleting tasks
const deleted = manager.deleteTask(taskId2);
assert(deleted === true, 'Should delete task');

const remainingTasks = manager.getTasks();
assert(remainingTasks.length === 1, 'Should have 1 remaining task');

console.log('✓ Task deletion works');

// Test statistics
const stats = manager.getStats();
assert(stats.total === 1, 'Should have 1 total task');
assert(stats.completed === 1, 'Should have 1 completed task');
assert(stats.pending === 0, 'Should have 0 pending tasks');
assert(stats.categories.includes('work'), 'Should include work category');

console.log('✓ Statistics work');

console.log('All tests passed! ✅');
      `);

      // Run tests
      execSync('node test-comprehensive.js', { cwd: e2eDir, stdio: 'pipe' });

      // Run verification with oracle
      const verifyResult = execSync('node dist/index.js verify', { cwd: e2eDir, stdio: 'pipe' });
      assert(verifyResult, 'Comprehensive E2E verification should pass');

      // Check performance
      execSync('node dist/index.js performance --check', { cwd: e2eDir, stdio: 'pipe' });

      console.log('✅ Comprehensive E2E test passed');

    } finally {
      // Cleanup
      await fs.rm(e2eDir, { recursive: true, force: true });
    }
  });
});