# Zipply Project Rules

## Project Context

This workspace contains **Zipply** — an Electron + TypeScript desktop application.

When the user asks questions about:
- "агенты", "сабагенты", "вызов сабагентов" → refers to Zipply's internal agent orchestration code
- "навыки", "скиллы", "skills" → refers to Zipply's skills system implementation
- "ии", "модель", "промпт" → refers to how Zipply integrates with AI models, NOT to this assistant
- "улучшить", "прокачать", "добавить" without specifying the AI assistant → refers to Zipply features

## Default Subject

Unless the user explicitly addresses this assistant ("ты сама", "Antigravity", "ты как ии"), treat all questions as being about **Zipply's codebase and features**.
