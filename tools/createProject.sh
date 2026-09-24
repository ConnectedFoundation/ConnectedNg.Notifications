#!/bin/bash
set -e

exitPrompt()
{
    read -p "Press any key to exit"
}

newLine(){
    echo ""
}

newLines(){
    echo ""
    echo ""
}

toKebabCase(){
    kebab=$1
    while [[ "$kebab" =~ (.*[a-z0-9])([A-Z].*) ]] && kebab="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}"; do
    :  # do nothing
    done

    echo $kebab | tr '[:upper:]' '[:lower:]'
}

helpFunction()
{
   echo ""
   echo "Usage: "
   echo "  $0 -p name-of-the-project"
   echo "  $0 --project-name name-of-the-project" 
   echo ""
   exitPrompt
   exit 1 # Exit script after printing help
}

projectName=""

while [[ "$#" -gt 0 ]]
do case $1 in
    -p|--project-name) projectName="$2"
    shift;;
    *) echo "Unknown parameter passed: $1"
    exitPrompt
    exit 1;;
esac
shift
done

if [ -z $projectName ]; then
    echo "No project name supplied, exiting."
    newLines
    helpFunction
    newLines
    exitPrompt
    exit 100
fi

newLines

echo "Generating workspace..."
ng new "@ConnectedNg.$projectName" --no-create-application -p cf
newLine
echo "Workspace generated."

newLines

echo "Generting project..."
cd "ConnectedNg.$projectName"
ng g library "@connected-ng/$projectName" -p cf
newLine
echo "Project generated."

newLines

echo "Cleaning up..."
rm -R "./projects/connected-ng/$(toKebabCase $projectName)/src/lib"
echo "export default {};" > "./projects/connected-ng/$(toKebabCase $projectName)/src/public-api.ts"
newLine
echo "Done."