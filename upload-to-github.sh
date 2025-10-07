#!/bin/bash

# GitHub Upload Script for Anki Quiz Generator
# Run this after creating a repository on GitHub

echo "🚀 Anki Quiz Generator - GitHub Upload Helper"
echo ""

read -p "Enter your GitHub username: " username
read -p "Enter your repository name (e.g., obsidian-anki-quiz-generator): " repo_name

echo ""
echo "Setting up remote origin..."
git remote add origin "https://github.com/$username/$repo_name.git"

echo "Pushing to GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "✅ Successfully uploaded to GitHub!"
echo "🔗 Your repository: https://github.com/$username/$repo_name"
echo ""
echo "📋 Next steps:"
echo "1. Update manifest.json with your GitHub details"
echo "2. Update README.md with your username"
echo "3. Create a release for Obsidian community"