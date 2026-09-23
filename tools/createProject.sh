#!/bin/bash
#
# Creates a ConnectedNg Angular library project inside src/.
#
# Run from the repo root (where tools/ is located).
# The repo should already exist (cloned from repobase.angular template).
#
# Usage:
#   tools/createProject.sh -p Components
#   tools/createProject.sh -p StyleKit --prefix cn
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

exitPrompt() { read -p "Press any key to exit"; }
newLine() { echo ""; }
newLines() { echo ""; echo ""; }

toKebabCase() {
	kebab=$1
	while [[ "$kebab" =~ (.*[a-z0-9])([A-Z].*) ]] && kebab="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}"; do :; done
	echo "$kebab" | tr '[:upper:]' '[:lower:]'
}

helpFunction() {
	echo ""
	echo "Scaffolds a ConnectedNg Angular library inside src/."
	echo ""
	echo "Usage:"
	echo "  $0 -p ProjectName"
	echo "  $0 --project-name ProjectName [--prefix cn]"
	echo ""
	echo "Examples:"
	echo "  $0 -p Components        → @connected-ng/components"
	echo "  $0 -p StyleKit          → @connected-ng/style-kit"
	echo "  $0 -p Core --prefix cn  → @connected-ng/core"
	echo ""
	exitPrompt
	exit 1
}

# ── Prerequisites ────────────────────────────────────────────────────
command -v ng  >/dev/null 2>&1 || { echo "Error: Angular CLI (ng) is not installed."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is not installed."; exit 1; }

# ── Parse arguments ─────────────────────────────────────────────────
projectName=""
prefix="cn"

while [[ "$#" -gt 0 ]]; do
	case $1 in
		-p|--project-name) projectName="$2"; shift;;
		--prefix) prefix="$2"; shift;;
		-h|--help) helpFunction;;
		*) echo "Unknown parameter: $1"; exitPrompt; exit 1;;
	esac
	shift
done

if [ -z "$projectName" ]; then
	echo "No project name supplied."
	newLines; helpFunction
fi

# Validate project name (PascalCase, alphanumeric only)
if [[ ! "$projectName" =~ ^[A-Za-z][A-Za-z0-9]*$ ]]; then
	echo "Error: Project name must be alphanumeric and start with a letter (e.g. Components, StyleKit)."
	exit 1
fi

kebabName=$(toKebabCase "$projectName")
packageName="@connected-ng/$kebabName"

newLines
echo "╔══════════════════════════════════════════════════╗"
echo "║  ConnectedNg.$projectName"
echo "║  Package: $packageName"
echo "║  Prefix:  $prefix"
echo "╚══════════════════════════════════════════════════╝"
newLine

# ── Generate Angular workspace in temp directory ─────────────────────
TMPDIR=$(mktemp -d)
trap "rm -rf '$TMPDIR'" EXIT

echo "→ Generating Angular workspace..."
ng new "workspace" \
	--no-create-application \
	--skip-git \
	--package-manager=npm \
	--directory="$TMPDIR/workspace"
newLine

echo "→ Generating library project..."
cd "$TMPDIR/workspace"
ng g library "$packageName" -p "$prefix"
newLine

# ── Copy workspace files to src/ ─────────────────────────────────────
echo "→ Setting up project structure..."

# Copy Angular workspace files (skip .editorconfig — we have our own)
for item in angular.json package.json tsconfig.json projects; do
	if [ -e "$item" ]; then
		cp -r "$item" "$REPO_ROOT/src/"
	fi
done

cd "$REPO_ROOT/src"

# ── Clean up default library boilerplate ─────────────────────────────
rm -rf "./projects/connected-ng/$kebabName/src/lib"
echo "export default {};" > "./projects/connected-ng/$kebabName/src/public-api.ts"

# ── Configure workspace package.json ─────────────────────────────────
KEBAB_NAME="$kebabName" PACKAGE_NAME="$packageName" node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.name = process.env.PACKAGE_NAME;
pkg.version = '0.0.0';
pkg.private = true;
pkg.scripts = {
	ng: 'ng',
	start: 'ng serve',
	build: 'ng build',
	watch: 'ng build --watch --configuration development',
	test: 'ng test'
};
pkg.prettier = {
	printWidth: 100,
	singleQuote: true,
	singleAttributePerLine: true,
	bracketSameLine: false,
	overrides: [{ files: '*.html', options: { parser: 'angular' } }]
};
pkg.publishConfig = { directory: 'dist/connected-ng/' + process.env.KEBAB_NAME };
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# ── Configure tsconfig.json ──────────────────────────────────────────
KEBAB_NAME="$kebabName" PACKAGE_NAME="$packageName" node -e "
const fs = require('fs');
const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
// Extend workspace base tsconfig (when used as submodule)
tsconfig.extends = ['../../tsconfig.base.json'];
// Set up library paths
if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
tsconfig.compilerOptions.paths = {
	[process.env.PACKAGE_NAME + '/*']: ['./dist/connected-ng/' + process.env.KEBAB_NAME + '/*'],
	[process.env.PACKAGE_NAME]: ['./dist/connected-ng/' + process.env.KEBAB_NAME]
};
fs.writeFileSync('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n');
"

# ── Configure angular.json (disable cache, set SCSS style) ──────────
KEBAB_NAME="$kebabName" PACKAGE_NAME="$packageName" node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('angular.json', 'utf8'));

// Disable CLI cache
cfg.cli = cfg.cli || {};
cfg.cli.analytics = false;
cfg.cli.cache = { enabled: false };

// Add SCSS schematics default
cfg.schematics = cfg.schematics || {};
cfg.schematics['@schematics/angular:component'] = { style: 'scss' };

fs.writeFileSync('angular.json', JSON.stringify(cfg, null, 2) + '\n');
"

# ── Create .npmrc ────────────────────────────────────────────────────
cat > .npmrc << 'EOF'
shamefully-hoist=true
link-workspace-packages=true
strict-peer-dependencies=false
node-linker=hoisted
EOF

# ── Create src/.gitignore ────────────────────────────────────────────
cat > .gitignore << 'EOF'
# Compiled output
/dist
/tmp
/out-tsc
/bazel-out

# Node
/node_modules
npm-debug.log
yarn-error.log

# IDEs and editors
.idea/
.project
.classpath
.c9/
*.launch
.settings/
*.sublime-workspace

# Visual Studio Code
.vscode/*
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json
.history/*

# Miscellaneous
/.angular/cache
.sass-cache/
/connect.lock
/coverage
/libpeerconnection.log
testem.log
/typings
__screenshots__/

# System files
.DS_Store
Thumbs.db
EOF

newLines
echo "✓ Project created successfully!"
newLine
echo "Structure:"
echo "  src/"
echo "  ├── angular.json"
echo "  ├── package.json              ($packageName)"
echo "  ├── tsconfig.json"
echo "  ├── .npmrc"
echo "  ├── .gitignore"
echo "  └── projects/"
echo "      └── connected-ng/"
echo "          └── $kebabName/"
echo "              ├── ng-package.json"
echo "              ├── package.json"
echo "              ├── src/public-api.ts"
echo "              ├── tsconfig.lib.json"
echo "              ├── tsconfig.lib.prod.json"
echo "              └── tsconfig.spec.json"
newLine
echo "Next steps:"
echo "  cd src && npm install && ng build"
newLine