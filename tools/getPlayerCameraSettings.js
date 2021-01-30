/* eslint-disable no-use-before-define */
// const readline = require('readline');
const chalk = require('chalk');
// const path = require('path');

const fs = require('fs');

require('dotenv').config();

const { SEASON_NUMBER, JSON_LOC } = process.env;

// required env vars
if (!SEASON_NUMBER) {
  console.log(chalk.yellow('Required SEASON_NUMBER environment variable not found.'));
  process.exit(1);
}

console.log(chalk.magenta('Parsing replays for Season'), chalk.magentaBright(`${SEASON_NUMBER}`));

(async () => {
  try {
    const files = await fs.promises.readdir(JSON_LOC);

    let numJsonFiles = 0;

    const playerSettings = new Map();
    for (const file of files) {
      if (file.toLowerCase().endsWith('.json')) { // only JSON files
        numJsonFiles++;
        console.log(chalk.cyan('get data from file ['), file, chalk.cyan(']'));
        try {
          const data = await getDataFromReplay(file);
          console.log(chalk.cyanBright(`got data, now save it [${file}]`));
          // console.log(JSON.stringify(data, null, 2));
          // console.log(data.playerStats.map((p) => `${p.name}:${p.teamName} [${p.maxTeam}]`));
          // const numRows = await updateSheet(data);
          // console.log(`Inserted ${numRows} data rows`);

          Object.keys(data).forEach((p) => playerSettings.set(p, data[p]));

          // add a delay
          // await delay(3000);
        } catch (err) {
          console.log(chalk.yellow(`JSON [${file}]:`, err));
        }
      }
    }
    console.log('Parsed', chalk.yellowBright(numJsonFiles), 'files');
    // console.log(Object.fromEntries(playerSettings.entries()));
    // ofthemoon16: {
    //   stiffness: 0.5,
    //   height: 120,
    //   transitionSpeed: 1,
    //   pitch: -3,
    //   swivelSpeed: 2.5,
    //   fieldOfView: 95,
    //   distance: 270
    // },
    console.log('player,stiffness,height,transitionSpeed,pitch,swivelSpeed,fieldOfView,distance');
    playerSettings.forEach((value, key) => {
      if (key && value) {
        let row = key;
        Object.keys(value).forEach((val) => {
          row += `,${value[val]}`;
        });
        console.log(row);
      } else {
        console.log(`${key},,,,,,,`);
      }
    })
  } catch (e) {
    console.error('Error getting JSON replays!', e);
  }
})();

function getDataFromReplay(replayFile) {
  return new Promise((resolve, reject) => {
    const replayPath = `../${JSON_LOC}/${replayFile}`;
    
    const replayJson = require(replayPath);

    // playlist: CUSTOM_LOBBY (private match), UNKNOWN (public ranked?)
    // see https://github.com/SaltieRL/carball/blob/3e66f175378f050b84bc9a3b15de0420505092a7/api/metadata/game_metadata.proto#L8
    // if UNKNOWN, "unknownPlaylist": 34
    const { playlist } = replayJson.gameMetadata;

    if (playlist !== 'CUSTOM_LOBBY') {
      reject('not CUSTOM_LOBBY playlist, not RLL?');
    }
    const retData = {};

    const { players, mutators } = replayJson;
    
    // check mutators -- ignore if needed
    //  ballType: DEFAULT, BASKETBALL, PUCK, CUBEBALL, BREAKOUT
    //  gameMutatorIndex: -1 or 0? not sure what this means
    if (mutators.ballType !== 'DEFAULT') {
      reject('not DEFAULT ballType, not RLL');
    }

    players.forEach((player) => {
      retData[player.name] = player.cameraSettings;
    });

    resolve(retData);
  });
}
