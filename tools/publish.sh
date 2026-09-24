#!/bin/bash
branch=$(git branch --show-current)

source "$(dirname "$0")/version.sh"

ng build

distDir=$(find ../../../dist -name package.json -exec dirname {} \;)

cdir=$(PWD)

cd $distDir

if [[ "$branch" == "main" || "$branch" == "master" ]]; then
    npm publish --access=public
else
    npm publish --tag $branch --access=public
fi

cd $cdir
version=$(npm pkg get version | tr -d "\"")

git add package.json
git add package-lock.json
git commit -m "vrs: increment version to \"$version\""
git tag -a $version -m "vrs: publish package \"$version\""
git push
git push origin tag $version

