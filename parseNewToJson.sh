#!/bin/bash
source .env

echo "Looking for new replays in [$REPLAY_LOC]"
# echo $JSON_LOC

# iterate over files in REPLAY_LOC
#   parse REPLAY with rrrocket (changed to carball)
#   move REPLAY somewhere else
if [[ -d "$REPLAY_LOC" && $(ls -A "$REPLAY_LOC") ]]; then
    i=0
    for fullfile in "$REPLAY_LOC/"*.replay; do
        nopath=${fullfile##*/}
        file=${nopath%%.*}
        # echo "$file"
        # ./rrrocket "$fullfile" > "$JSON_LOC/$file.json"
        carball -i "$fullfile" --json "$JSON_LOC/$file.json"
        mv "$fullfile" "$JSON_LOC/parsed"
        i=$((i+1))
    done
    echo "Parsed $i replays with output in [$JSON_LOC]"
else
    echo "No new replays"
fi
