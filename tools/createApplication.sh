#!/bin/bash
#
# Configures the src/ workspace for a ConnectedNg application.
#
# Run from the repo root (cloned from repobase.angular).
# The repo structure (docs/, tools/, .gitignore) already exists.
#
# This script:
#   1. Adds ConnectedNg library submodules under src/
#   2. Generates an Angular application under src/<OrgNg.Name>/
#   3. Creates the pnpm workspace config (package.json, pnpm-workspace.yaml, etc.)
#   4. Configures .vscode/ inside src/
#
# Usage:
#   tools/createApplication.sh -o MOM -n OperationsCenter -p mom
#   tools/createApplication.sh --org MOM --name OperationsCenter --prefix mom
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
	echo "Configures the src/ workspace for a ConnectedNg application."
	echo "Run from the repo root (cloned from repobase.angular)."
	echo ""
	echo "Usage:"
	echo "  $0 -o Org -n Name -p prefix"
	echo ""
	echo "Required:"
	echo "  -o, --org         Organization name (e.g. MOM)"
	echo "  -n, --name        Application name in PascalCase (e.g. OperationsCenter)"
	echo "  -p, --prefix      Angular selector prefix (e.g. mom)"
	echo ""
	echo "Optional:"
	echo "  --github-org      GitHub organization for submodules (default: ConnectedFoundation)"
	echo "  --skip-submodules Skip adding git submodules (just write .gitmodules)"
	echo ""
	echo "Example:"
	echo "  $0 -o MOM -n OperationsCenter -p mom"
	echo ""
	exitPrompt
	exit 1
}

# ── Prerequisites ────────────────────────────────────────────────────
command -v ng   >/dev/null 2>&1 || { echo "Error: Angular CLI (ng) is not installed."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is not installed."; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "Error: git is not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "Error: pnpm is not installed."; exit 1; }

# ── Parse arguments ─────────────────────────────────────────────────
orgName=""
appName=""
prefix=""
githubOrg="ConnectedFoundation"
skipSubmodules=false

while [[ "$#" -gt 0 ]]; do
	case $1 in
		-o|--org) orgName="$2"; shift;;
		-n|--name) appName="$2"; shift;;
		-p|--prefix) prefix="$2"; shift;;
		--github-org) githubOrg="$2"; shift;;
		--skip-submodules) skipSubmodules=true;;
		-h|--help) helpFunction;;
		*) echo "Unknown parameter: $1"; exitPrompt; exit 1;;
	esac
	shift
done

if [ -z "$orgName" ] || [ -z "$appName" ] || [ -z "$prefix" ]; then
	echo "Error: --org, --name, and --prefix are all required."
	newLines; helpFunction
fi

if [[ ! "$orgName" =~ ^[A-Za-z][A-Za-z0-9]*$ ]]; then
	echo "Error: Org name must be alphanumeric and start with a letter."; exit 1
fi
if [[ ! "$appName" =~ ^[A-Za-z][A-Za-z0-9]*$ ]]; then
	echo "Error: App name must be alphanumeric and start with a letter."; exit 1
fi
if [[ ! "$prefix" =~ ^[a-z][a-z0-9]*$ ]]; then
	echo "Error: Prefix must be lowercase alphanumeric."; exit 1
fi

# Verify we're in a repo root with the expected structure
if [ ! -d "$REPO_ROOT/.git" ]; then
	echo "Error: No .git directory found at $REPO_ROOT. Run this from a cloned repobase.angular repo."
	exit 1
fi

# ── Derived names ────────────────────────────────────────────────────
orgKebab=$(toKebabCase "$orgName")
appKebab=$(toKebabCase "$appName")
appFolder="${orgName}Ng.${appName}"
packageName="${orgKebab}-ng/${appKebab}"
workspaceName="${orgKebab}-ng-${appKebab}-workspace"

NG_VERSION=$(ng version 2>&1 | grep -oP 'Angular CLI: \K\d+\.\d+' | head -1)
if [ -z "$NG_VERSION" ]; then
	NG_VERSION="21.0"
fi

newLines
echo "╔══════════════════════════════════════════════════╗"
echo "║  Creating application workspace in src/"
echo "║  App:     $appFolder"
echo "║  Package: $packageName"
echo "║  Prefix:  $prefix"
echo "║  Angular: ~${NG_VERSION}.0"
echo "╚══════════════════════════════════════════════════╝"
newLine

if [ -d "$REPO_ROOT/src/$appFolder" ]; then
	echo "Error: src/$appFolder already exists."
	exit 1
fi

# ══════════════════════════════════════════════════════════════════════
# 1. Add ConnectedNg submodules
# ══════════════════════════════════════════════════════════════════════
cd "$REPO_ROOT"
CONNECTED_MODULES=(Core StyleKit Layouts Components)

if [ "$skipSubmodules" = true ]; then
	echo "→ Writing .gitmodules (submodule cloning skipped)..."
	cat > .gitmodules << GITMODULES
[submodule "src/ConnectedNg.Core"]
	path = src/ConnectedNg.Core
	url = git@github.com:${githubOrg}/ConnectedNg.Core.git
[submodule "src/ConnectedNg.StyleKit"]
	path = src/ConnectedNg.StyleKit
	url = git@github.com:${githubOrg}/ConnectedNg.StyleKit.git
[submodule "src/ConnectedNg.Layouts"]
	path = src/ConnectedNg.Layouts
	url = git@github.com:${githubOrg}/ConnectedNg.Layouts.git
[submodule "src/ConnectedNg.Components"]
	path = src/ConnectedNg.Components
	url = git@github.com:${githubOrg}/ConnectedNg.Components.git
GITMODULES
	echo "  ⚠ Run 'git submodule update --init --recursive' after setting up remotes."
else
	echo "→ Adding ConnectedNg submodules..."
	for module in "${CONNECTED_MODULES[@]}"; do
		echo "  Adding ConnectedNg.$module..."
		git submodule add "git@github.com:${githubOrg}/ConnectedNg.${module}.git" "src/ConnectedNg.${module}" 2>/dev/null || {
			echo "  ⚠ Failed to add ConnectedNg.$module — you can add it manually:"
			echo "    git submodule add git@github.com:${githubOrg}/ConnectedNg.${module}.git src/ConnectedNg.${module}"
		}
	done
fi
newLine

# ══════════════════════════════════════════════════════════════════════
# 2. Generate Angular application
# ══════════════════════════════════════════════════════════════════════
echo "→ Generating Angular application..."
cd "$REPO_ROOT/src"
ng new "$appFolder" \
	--prefix "$prefix" \
	--style scss \
	--skip-git \
	--skip-install \
	--package-manager=npm
newLine

# ── Patch angular.json (add assets, preserveSymlinks, disable cache) ─
echo "→ Configuring Angular application..."
APP_FOLDER="$appFolder" node -e "
const fs = require('fs');
const appFolder = process.env.APP_FOLDER;
const cfg = JSON.parse(fs.readFileSync(appFolder + '/angular.json', 'utf8'));
const projectName = Object.keys(cfg.projects)[0];
const project = cfg.projects[projectName];
const buildOpts = project.architect.build.options;

// Add Connected assets
buildOpts.assets = buildOpts.assets || [];
buildOpts.assets.push(
	{ glob: '*', input: 'src/assets/config', output: 'config' },
	{ glob: '**/*', input: 'node_modules/@connected-ng/style-kit/assets/images', output: 'assets/images' }
);

// Add preserveSymlinks to development config
if (project.architect.build.configurations && project.architect.build.configurations.development) {
	project.architect.build.configurations.development.preserveSymlinks = true;
}

// Disable cache
cfg.cli = cfg.cli || {};
cfg.cli.cache = { enabled: false };

fs.writeFileSync(appFolder + '/angular.json', JSON.stringify(cfg, null, 2) + '\n');
"

# ── Patch app package.json (add workspace:* Connected deps) ──────
APP_FOLDER="$appFolder" PACKAGE_NAME="$packageName" node -e "
const fs = require('fs');
const appFolder = process.env.APP_FOLDER;
const packageName = process.env.PACKAGE_NAME;
const pkg = JSON.parse(fs.readFileSync(appFolder + '/package.json', 'utf8'));

pkg.name = packageName;

// Add ConnectedNg workspace dependencies
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies['@connected-ng/components'] = 'workspace:*';
pkg.dependencies['@connected-ng/core'] = 'workspace:*';
pkg.dependencies['@connected-ng/layouts'] = 'workspace:*';
pkg.dependencies['@connected-ng/style-kit'] = 'workspace:*';
pkg.dependencies['@microsoft/signalr'] = '^10.0.0';

// Sort dependencies
const sorted = {};
Object.keys(pkg.dependencies).sort().forEach(k => sorted[k] = pkg.dependencies[k]);
pkg.dependencies = sorted;

pkg.prettier = {
	singleAttributePerLine: true,
	bracketSameLine: false,
	overrides: [{ files: '*.html', options: { parser: 'angular' } }]
};

fs.writeFileSync(appFolder + '/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# ── Create assets/config/config.json ─────────────────────────────
mkdir -p "$appFolder/src/assets/config"
cat > "$appFolder/src/assets/config/config.json" << 'EOF'
{
	"baseUrl": "http://localhost:5000"
}
EOF

# ── Create app directory scaffolding ─────────────────────────────
mkdir -p "$appFolder/src/"{components,interceptors,services,shared,views}

# ── Overwrite styles.scss with Connected theme ───────────────────
cat > "$appFolder/src/styles.scss" << 'EOF'
@use "@connected-ng/style-kit/utilities";
@use "@angular/material" as mat;
@use "@connected-ng/style-kit/themes/connected";

html {
	color-scheme: light dark;
	@include mat.theme((
		color: (primary: mat.$azure-palette, tertiary: mat.$orange-palette),
		typography: Roboto,
	));
}

body {
	margin: 0;
	font-family: Roboto, "Helvetica Neue", sans-serif;
}
EOF

newLine

# ══════════════════════════════════════════════════════════════════════
# 3. Create pnpm workspace configuration in src/
# ══════════════════════════════════════════════════════════════════════
echo "→ Setting up pnpm workspace..."

# ── pnpm-workspace.yaml ──────────────────────────────────────────
cat > pnpm-workspace.yaml << YAML
packages:
   # Library source folders
   - "ConnectedNg.StyleKit/src"
   - "ConnectedNg.Layouts/src"
   - "ConnectedNg.Core/src"
   - "ConnectedNg.Components/src"

   # Application source folders
   - "${appFolder}"
YAML

# ── Workspace root package.json ──────────────────────────────────
APP_FOLDER="$appFolder" WORKSPACE_NAME="$workspaceName" PACKAGE_NAME="$packageName" \
NG_VERSION="$NG_VERSION" node -e "
const fs = require('fs');
const appFolder = process.env.APP_FOLDER;
const wsName = process.env.WORKSPACE_NAME;
const pkgName = process.env.PACKAGE_NAME;
const ngMajor = process.env.NG_VERSION.split('.')[0];
const ngVer = '>=' + ngMajor + '.0.0';

const pkg = {
	name: wsName,
	version: '1.0.0',
	private: true,
	description: appFolder + ' Workspace',
	scripts: {
		'build:stylekit': 'pnpm --filter @connected-ng/style-kit build',
		'build:layouts': 'pnpm --filter @connected-ng/layouts build',
		'build:core': 'pnpm --filter @connected-ng/core build',
		'build:components': 'pnpm --filter @connected-ng/components build',
		'build:libs': [
			'pnpm --filter @connected-ng/style-kit build',
			'pnpm --filter @connected-ng/layouts build',
			'pnpm --filter @connected-ng/core build',
			'pnpm --filter @connected-ng/components build'
		].join(' && '),
		'build:project': 'pnpm --filter ' + pkgName + ' build',
		'start:project': 'pnpm --filter ' + pkgName + ' start',
		'watch:stylekit': 'pnpm --filter @connected-ng/style-kit watch',
		'watch:layouts': 'pnpm --filter @connected-ng/layouts watch',
		'watch:core': 'pnpm --filter @connected-ng/core watch',
		'watch:components': 'pnpm --filter @connected-ng/components watch',
		'dev:help': \"echo '\\n\" +
			\"Development Mode — Run these commands in separate terminals:\\n\\n\" +
			\"  Terminal 1: pnpm watch:stylekit\\n\" +
			\"  Terminal 2: pnpm watch:layouts\\n\" +
			\"  Terminal 3: pnpm start:project\\n\\n\" +
			\"Tip: Start them in this order and wait for each to complete its first build.\\n'\",
		'test:all': 'pnpm -r test',
		'clean': 'pnpm -r exec -- rm -rf dist node_modules'
	},
	engines: { node: '>=18.0.0', pnpm: '>=10.0.0' },
	pnpm: {
		overrides: {
			'@angular/animations': ngVer,
			'@angular/cdk': ngVer,
			'@angular/common': ngVer,
			'@angular/compiler': ngVer,
			'@angular/core': ngVer,
			'@angular/forms': ngVer,
			'@angular/material': ngVer,
			'@angular/platform-browser': ngVer,
			'@angular/platform-browser-dynamic': ngVer,
			'@angular/router': ngVer,
			'@angular-devkit/build-angular': ngVer,
			'@angular/cli': ngVer,
			'@angular/compiler-cli': ngVer,
			'ng-packagr': ngVer
		}
	}
};

fs.writeFileSync('package.json', JSON.stringify(pkg, null, '\t') + '\n');
"

# ── tsconfig.base.json ───────────────────────────────────────────
cat > tsconfig.base.json << 'EOF'
{
  "compilerOptions": {
    "composite": true,
    "declaration": true
  }
}
EOF

# ── .npmrc ───────────────────────────────────────────────────────
cat > .npmrc << 'EOF'
shamefully-hoist=true

# Enable workspace package linking
link-workspace-packages=true

# Don't fail on peer dependency warnings
strict-peer-dependencies=false

# Use hoisted node-linker for shared dependencies
node-linker=hoisted
EOF

# ══════════════════════════════════════════════════════════════════════
# 4. Configure .vscode/ inside src/
# ══════════════════════════════════════════════════════════════════════
echo "→ Configuring VS Code settings..."
mkdir -p .vscode

APP_FOLDER="$appFolder" node -e "
const fs = require('fs');
const appFolder = process.env.APP_FOLDER;

// launch.json
const launch = {
	version: '0.2.0',
	configurations: [{
		name: 'Angular: Launch Chrome',
		type: 'chrome',
		request: 'launch',
		url: 'http://localhost:4200/',
		webRoot: '\${workspaceFolder}/' + appFolder,
		sourceMaps: true,
		resolveSourceMapLocations: [
			'\${workspaceFolder}/**',
			'!\${workspaceFolder}/**/node_modules/@connected-ng/**'
		],
		sourceMapPathOverrides: {
			'webpack:///./*': '\${webRoot}/src/*',
			'webpack:///src/*': '\${webRoot}/src/*',
			'webpack:///*': '\${workspaceFolder}/*',
			'webpack:///./~/*': '\${webRoot}/node_modules/*',
			'/./*': '\${webRoot}/src/*',
			'*/projects/connected-ng/components/src/*': '\${workspaceFolder}/ConnectedNg.Components/src/projects/connected-ng/components/src/*',
			'*/projects/connected-ng/core/src/*': '\${workspaceFolder}/ConnectedNg.Core/src/projects/connected-ng/core/src/*',
			'*/projects/connected-ng/layouts/src/*': '\${workspaceFolder}/ConnectedNg.Layouts/src/projects/connected-ng/layouts/src/*',
			'*/projects/connected-ng/style-kit/src/*': '\${workspaceFolder}/ConnectedNg.StyleKit/src/projects/connected-ng/style-kit/src/*'
		}
	}]
};
fs.writeFileSync('.vscode/launch.json', JSON.stringify(launch, null, '\t') + '\n');

// settings.json
const settings = {
	'git.ignoreLimitWarning': true,
	'html.format.wrapAttributes': 'force-aligned'
};
fs.writeFileSync('.vscode/settings.json', JSON.stringify(settings, null, '\t') + '\n');
"

newLines
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✓ Application workspace created successfully!   "
echo "╚══════════════════════════════════════════════════╝"
newLine
echo "Structure:"
echo "  src/"
echo "  ├── ConnectedNg.Components/   (submodule)"
echo "  ├── ConnectedNg.Core/         (submodule)"
echo "  ├── ConnectedNg.Layouts/      (submodule)"
echo "  ├── ConnectedNg.StyleKit/     (submodule)"
echo "  ├── $appFolder/       (app)"
echo "  ├── pnpm-workspace.yaml"
echo "  ├── package.json"
echo "  ├── tsconfig.base.json"
echo "  ├── .npmrc"
echo "  └── .vscode/"
newLine
echo "Next steps:"
echo "  cd src"
echo "  pnpm install"
echo "  pnpm build:libs"
echo "  pnpm start:project"
newLine
