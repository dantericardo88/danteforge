#!/bin/bash
# DanteForge Showcase Demo

echo "🚀 DanteForge Showcase Demo"
echo "============================"

echo ""
echo "This demo will show DanteForge building a simple todo app"
echo ""

# Initialize
echo "1. Initializing project..."
danteforge init --non-interactive

# Constitution
echo "2. Setting up constitution..."
echo "Zero ambiguity in requirements
Progressive enhancement approach
Accessible by default
Performance-first development" | danteforge constitution

# Specification
echo "3. Creating specification..."
danteforge specify "Build a todo application with add, complete, and delete functionality" --prompt

echo ""
echo "Demo complete! Check the .danteforge/ directory for generated artifacts."
echo "Run 'danteforge assess' to see quality scores."
