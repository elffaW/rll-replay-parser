# REPLAY PARSER
Parses Rocket League replays and puts stats into a google sheet

## Requirements
---
- bash
- node (developed with v12) and npm (v6)
- carball CLI utility (can be installed with pip: `pip install carball`)
- Create and configure `.env` file in root dir (see `env.sample`)

## How to run
---
`./main.sh` is an easy way to run the full process.
### What does that do?
- Parses .replay files from Rocket League with `carball`
- Moves parsed .replay files out of main dir when processed
- Processes the resulting JSON files with JS, pulling out desired stats
- Inserts desired stats into a Google sheet (must already exist in specific format)
- Moves processed JSON files when finished

You may also run individual steps as desired. See main.sh for the commands it runs.
