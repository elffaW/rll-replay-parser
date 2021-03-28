/* eslint-disable no-use-before-define */
// const readline = require('readline');
const chalk = require('chalk');
// const path = require('path');

const fs = require('fs');

(async () => {
  try {
    const STAT_FOLDER = '/e/Coding/rll-data/stats';
    const files = await fs.promises.readdir(STAT_FOLDER);

    let numJsonFiles = 0;

    const hitsByPlayerName = {};
    let allHits = [];
    // const gamesNoGoals = [];
    // let allGoals = [];

    for (const file of files) {
      if (file.endsWith('_hitsByPlayer.json')) { // looking for files like s5_hitsByPlayer.json
        numJsonFiles++;
        console.log(chalk.cyan('get data from file ['), file, chalk.cyan(']'));
        try {
          // const hits = await getHitsByPlayer(file);
          // console.log(chalk.cyanBright(`got data, now save it [${file}]`));
          const replayJson = require(`${STAT_FOLDER}/${file}`);

          /** for writing stats to files */
          Object.keys(replayJson).forEach((playerName) => {
            if (!hitsByPlayerName[playerName]) {
              hitsByPlayerName[playerName] = [];
            }
            hitsByPlayerName[playerName] = hitsByPlayerName[playerName].concat(replayJson[playerName]);

            allHits = allHits.concat(replayJson[playerName]);
          });
          // const { goals, ...gameWithoutGoalsArray } = data.gameStats;
          // gamesNoGoals.push(gameWithoutGoalsArray);
          // allGoals = allGoals.concat(data.gameStats.goals);

          // add a delay
          // await delay(3000);
        } catch (err) {
          console.log(chalk.yellow(`JSON [${file}]:`, err));
        }
      }
    }
    fs.writeFileSync(`${STAT_FOLDER}/hitsByPlayer.json`, JSON.stringify(hitsByPlayerName), err => {});
    const writer = fs.createWriteStream(`${STAT_FOLDER}/allHits.json`, { flags: 'a' });
    allHits.forEach((hit) => writer.write(`${JSON.stringify(hit)}\n`));
    writer.end();
    // fs.writeFileSync(`${STAT_FOLDER}/allHits.json`, JSON.stringify(allHits), err => {});
    Object.keys(hitsByPlayerName).forEach((player) => {
      console.log(`${player}: ${hitsByPlayerName[player].length}`);
    })
    console.log()
    console.log('Parsed', chalk.yellowBright(numJsonFiles), 'files');
  } catch (e) {
    console.error('Error getting files!', e);
  }
})();
