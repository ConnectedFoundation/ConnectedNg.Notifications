#!/bin/bash
branch=$(git branch --show-current)

if [[ "$branch" == "main" || "$branch" == "master" ]]; then
    npm version "$(date +%y).$([ $(date +%m) -le 6 ] && echo '1' || echo '2').$(date +%m%d).$(( ($(date -u +%s) % 86400) / 2 ))"
else
    npm version "$(date +%y).$([ $(date +%m) -le 6 ] && echo '1' || echo '2').$(date +%m%d)-$(git branch --show-current)$(( ($(date -u +%s) % 86400) / 2 ))"
fi