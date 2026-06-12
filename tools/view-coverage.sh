#!/bin/bash

# Test Coverage Report Script
# This script runs tests with coverage and opens the HTML report

echo "Running tests with coverage..."
npm run test:coverage

if [ $? -eq 0 ]; then
    echo "✅ Tests passed! Opening coverage report..."
    if command -v open &> /dev/null; then
        open coverage/lcov-report/index.html
    elif command -v xdg-open &> /dev/null; then
        xdg-open coverage/lcov-report/index.html
    else
        echo "Coverage report generated at: coverage/lcov-report/index.html"
        echo "Open this file in your browser to view detailed coverage."
    fi
else
    echo "❌ Tests failed. Check the output above for details."
    exit 1
fi