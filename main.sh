#!/bin/bash

echo "Parsing new .replay files to JSON"
echo

./parseNewToJson.sh

echo "Done parsing replay files"
echo
echo "Parse JSON and output to sheets"

npm run parse-replay

mv $JSON_LOC/*.json $JSON_LOC/done
