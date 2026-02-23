# Contributing to MeetPods

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/vinimlo/meetpods.git
cd meetpods
make setup   # Install deps + full build
make dev     # Launch app in dev mode
make test    # Run tests
```

### Requirements

- macOS 12+ (Monterey or later)
- Node.js 22+
- Python 3 (for `node-gyp` native compilation)
- Xcode Command Line Tools
- Google Chrome

**Recommended:** Install [mise](https://mise.jdx.dev) to auto-manage Node and Python versions. After installing mise, run `mise install` in the project root — it reads `.mise.toml` and `.nvmrc` to set up the correct versions automatically.

## Architecture

MeetPods has three layers:

```
Native (C++/ObjC++ NAPI) <-> Electron (TypeScript) <-> Chrome Extension (JS/WebSocket)
```

| Layer            | Location         | Language   |
| ---------------- | ---------------- | ---------- |
| Native addon     | `src/native/`    | C++/ObjC++ |
| Electron main    | `src/main/`      | TypeScript |
| Chrome extension | `src/extension/` | TypeScript |

Communication between Electron and the Chrome extension happens via WebSocket on `127.0.0.1:18432`.

## Making Changes

1. **Fork and clone** the repository
2. **Create a branch** from `main`: `git checkout -b my-feature`
3. **Make your changes** following the conventions below
4. **Run tests**: `make test`
5. **Run lint**: `make lint`
6. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation
   - `test:` test changes
   - `chore:` tooling/config
7. **Open a Pull Request** against `main`

## Code Conventions

- TypeScript strict mode
- Main process: CommonJS (`require`/`module.exports`)
- Chrome extension: ES2022 modules, bundled by esbuild
- Native addon: C++/ObjC++ with NAPI
- Formatting: Prettier (runs automatically via `make format`)
- Linting: ESLint with TypeScript rules

## Testing

```bash
make test        # Run once
make test-watch  # Watch mode
make coverage    # Coverage report
```

Coverage thresholds are enforced: 100% lines, 100% functions, 95% branches.

## Questions?

Open an [issue](https://github.com/vinimlo/meetpods/issues) — happy to help!
