#!/bin/bash
source .env

NOCOLOR='\033[0m'
PURPLE='\033[0;35m'
GREEN='\033[1;32m'
RED='\033[1;31m'

echo "Looking for new replays in [$REPLAY_LOC]"
# echo $JSON_LOC

numerror=0
numsuccess=0
# iterate over files in REPLAY_LOC
#   parse REPLAY with rrrocket (changed to carball)
#   move REPLAY somewhere else
if [[ -d "$REPLAY_LOC" && $(ls -A "$REPLAY_LOC") ]]; then
    i=0
    for fullfile in "$REPLAY_LOC/"*.replay; do
        nopath=${fullfile##*/}
        file=${nopath%.*}
        # echo "Parsing $fullfile"
        #./rrrocket "$fullfile" > "$JSON_LOC/$file.json"

        carball -i "$fullfile" --json "$JSON_LOC/$file.json"
        success=$?
		if [ "$success" -eq "0" ]; then
            echo
            echo -e "${GREEN}[SUCCESS] ${NOCOLOR}PARSED $fullfile"
            echo "... moving to $JSON_LOC/parsed"
            echo
			mv "$fullfile" "$JSON_LOC/parsed"
            numsuccess=$((numsuccess+1))
		else
            echo
			echo -e "${RED}[ERROR] ${NOCOLOR}FAILED PARSING $fullfile"
			echo
            numerror=$((numerror+1))
		fi
        i=$((i+1))
    done
    echo -e "Attempted to parse ${PURPLE}$i${NOCOLOR} replays"
    echo -e "    ${GREEN}$numsuccess succeeded${NOCOLOR} with JSON output in [$JSON_LOC]"
    echo -e "    ${RED}$numerror failed${NOCOLOR} and .replay files remain in [$REPLAY_LOC]"
else
    echo "No new replays"
fi

echo

