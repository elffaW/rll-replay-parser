/* eslint-disable no-use-before-define */
// const readline = require('readline');
const chalk = require('chalk');
// const path = require('path');

const fs = require('fs');

require('dotenv').config();

// import { PLAYER_RLNAME_MAP, PLAYER_TEAM_MAP } from './playerMap';
const playerMappings = require('./playerMap');
const { PLAYER_RLNAME_MAP, PLAYER_TEAM_MAP } = playerMappings;

const { SEASON_NUMBER, JSON_LOC } = process.env;


/**
 * indicate whether the games are combine games
 * - important because combine does not have teams yet, and no schedule for GN
 * - if true,
 *    - assign teams as ORANGE or BLUE
 *    - GN should just be incrementing int
 */
let IS_COMBINE = false;

// required env vars
if (!SEASON_NUMBER) {
  console.log(chalk.yellow('Required SEASON_NUMBER environment variable not found.'));
  process.exit(1);
}


// helper function to try to avoid Google API rate-limiting
const delay = (time) => new Promise((res) => setTimeout(res, time));

(async () => {
  try {
    const files = await fs.promises.readdir(JSON_LOC);

    let numJsonFiles = 0;

    const hitsByPlayerName = {};
    // const gamesNoGoals = [];
    // let allGoals = [];

    for (const file of files) {
      if (file.toLowerCase().endsWith('.json')) { // only JSON files
        numJsonFiles++;
        console.log(chalk.cyan('get data from file ['), file, chalk.cyan(']'));
        try {
          const data = await getDataFromReplay(file);
          console.log(chalk.cyanBright(`got data, now save it [${file}]`));

          /** for writing stats to files */

          Object.keys(data.hitStats).forEach((playerName) => {
            if (!hitsByPlayerName[playerName]) {
              hitsByPlayerName[playerName] = [];
            }
            hitsByPlayerName[playerName] = hitsByPlayerName[playerName].concat(data.hitStats[playerName]);
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
    fs.writeFileSync(`${JSON_LOC}/hitsByPlayer.json`, JSON.stringify(hitsByPlayerName), err => {});
    console.log('Parsed', chalk.yellowBright(numJsonFiles), 'files');
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
    const { id: gameId, score, teamSize, playlist, frames, length } = replayJson.gameMetadata;
    const { team0Score, team1Score } = score;
    
    if (playlist !== 'CUSTOM_LOBBY') {
      reject('not CUSTOM_LOBBY playlist, not RLL?');
    }
    const retData = {};
    
    retData.team0Score = !!team0Score ? team0Score : 0;
    retData.team1Score = !!team1Score ? team1Score : 0;
    retData.teamSize = teamSize;
    
    const { players, gameStats, mutators } = replayJson;
    const { hits } = gameStats;
    
    // check mutators -- ignore if needed
    //  ballType: DEFAULT, BASKETBALL, PUCK, CUBEBALL, BREAKOUT
    //  gameMutatorIndex: -1 or 0? not sure what this means
    if (mutators.ballType !== 'DEFAULT') {
      reject('not DEFAULT ballType, not RLL');
    }

    const actualPlayers = players.filter((p) => !!p.score);

    const playersWithTeams = actualPlayers.map((player) => {
      const team = IS_COMBINE
        ? (player.isOrange ? 'ORANGE' : 'BLUE')
        : PLAYER_TEAM_MAP[player.name.toLowerCase()];
      player.teamName = team;
      player.origTeam = team; // useful in case this player is subbing
      player.id = player.id.id; // fix stupid JSON

      return player;
    });

    // determine which teams are playing from the players
    // - sorts and takes team with most players (pops the last one off the list)
    // - if no team has a majority, random team will be popped off list
    // - only way to fix randomness would be to look at schedule and gametime to determine most likely teams to be playing
    const team0 = playersWithTeams.filter((player) => player.isOrange === 0);
    const team1 = playersWithTeams.filter((player) => player.isOrange === 1);

    const team0Max = team0.sort((a, b) => (
      team0.filter((p) => p.teamName === a.teamName).length -
      team0.filter((p) => p.teamName === b.teamName).length
    ));
    const team0MaxTeam = team0Max[0].teamName === 'BOTSBOTS' ? team0Max[1].teamName : team0Max.pop().teamName;
    const team1Max = team1.sort((a, b) => (
      team1.filter((p) => p.teamName === a.teamName).length -
      team1.filter((p) => p.teamName === b.teamName).length
    ));
    const team1MaxTeam = team1Max[0].teamName === 'BOTSBOTS' ? team1Max[1].teamName : team1Max.pop().teamName;

    const finalPlayerStats = playersWithTeams.map((p) => {
      p.teamName = (!!p.isOrange ? team1MaxTeam : team0MaxTeam);
      p.oppTeam = (!!!p.isOrange ? team1MaxTeam : team0MaxTeam);
      // p.maxTeam = (!!p.isOrange ? team1MaxTeam : team0MaxTeam);
      // p.maxOpp = (!!!p.isOrange ? team1MaxTeam : team0MaxTeam);

      return p;
    });

    

    /**
     * get hit info by player name
     * - Game ID
     * - Team, Opp Team
     * - Player
     * - Season
     * - Time in game
     * - probably in OT
     * - ...other hit info
     */
    const fps = frames / length; // random example replay has this as about 32
    
    const hitsByPlayerName = {};
    hits.forEach((hit) => {
      const { ...hitCopy } = hit;
      const playerId = hit.playerId.id;
      
      let curPlayer = playersWithTeams.find((player) => player.id === playerId);
      // saw one replay where there was a goal scored by a player ID that didn't show up in players array
      if (!curPlayer) {
        curPlayer = {
          name: 'UNKNOWN',
          teamName: 'UNKNOWN',
          oppTeam: 'UNKNOWN',
          isOrange: 'UNKNOWN',
        };
      }
      const { name, teamName, oppTeam, isOrange } = curPlayer;
      hitCopy.teamName = teamName;
      hitCopy.oppTeamName = oppTeam;
      hitCopy.playerName = name;
      hitCopy.playerId = playerId;
      hitCopy.isOrange = isOrange;

      hitCopy.timeOfHit = Math.round(hit.frameNumber / fps);
      hitCopy.isOT = (hit.goalNumber === -1);

      hitCopy.season = parseInt(SEASON_NUMBER, 10);
      hitCopy.gameId = gameId;

      if (!hitsByPlayerName[name]) {
        hitsByPlayerName[name] = [];
      }
      
      hitsByPlayerName[name].push(hitCopy);
    });

    retData.hitStats = hitsByPlayerName;

    if (!team0MaxTeam || !team1MaxTeam) {// || unevenTeams) {
      console.log('unevenTeams?', unevenTeams);
      // const plyrs = finalPlayerStats.map((p) => p.name);
      const plyrs = finalPlayerStats.map((p) => `[${p.teamName}]\t${p.origTeam}\t${p.name}\n`);
      reject(`ignore this game -- not RLL: \n${plyrs} [${plyrs.length} players]\tuneven? ${unevenTeams}`);
    } else {
      resolve(retData);
    }
  });
}
