/* eslint-disable no-use-before-define */
// const readline = require('readline');
const chalk = require('chalk');
// const path = require('path');

const fs = require('fs');

require('dotenv').config();

// import { PLAYER_RLNAME_MAP, PLAYER_TEAM_MAP } from './playerMap';
const playerMappings = require('./playerMap');
const { PLAYER_RLNAME_MAP, PLAYER_TEAM_MAP } = playerMappings;

const { GoogleSpreadsheet } = require('google-spreadsheet');

const { SEASON_NUMBER, JSON_LOC } = process.env;

let CUR_GAMENUM = 1;

// required env vars
if (!SEASON_NUMBER) {
  console.log(chalk.yellow('Required SEASON_NUMBER environment variable not found.'));
  process.exit(1);
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
  console.log(chalk.yellow('no GOOGLE_SERVICE_ACCOUNT_EMAIL env var set'));
  process.exit(1);
}
if (!process.env.GOOGLE_PRIVATE_KEY) {
  console.log(chalk.yellow('no GOOGLE_PRIVATE_KEY env var set'));
  process.exit(1);
}
if (!process.env.GOOGLE_SHEETS_SHEET_ID) {
  // spreadsheet key is the long id in the sheets URL
  console.log(chalk.yellow('no GOOGLE_SHEETS_SHEET_ID env var set'));
  process.exit(1);
}

console.log(chalk.magenta('Parsing replays for Season'), chalk.magentaBright(`${SEASON_NUMBER}`));

// helper function to try to avoid Google API rate-limiting
const delay = (time) => new Promise((res) => setTimeout(res, time));

(async () => {
  try {
    const files = await fs.promises.readdir(JSON_LOC);

    let numJsonFiles = 0;

    // const allGameStats = [];
    // const gamesNoGoals = [];
    // let allGoals = [];

    for (const file of files) {
      if (file.toLowerCase().endsWith('.json')) { // only JSON files
        numJsonFiles++;
        console.log(chalk.cyan('get data from file ['), file, chalk.cyan(']'));
        try {
          const data = await getDataFromReplay(file);
          console.log(chalk.cyanBright(`got data, now save it [${file}]`));
          // console.log(JSON.stringify(data, null, 2));
          // console.log(data.playerStats.map((p) => `${p.name}:${p.teamName} [${p.maxTeam}]`));
          const { gameRows, goalRows } = await updateSheet(data);
          console.log(`Inserted ${gameRows} game rows, ${goalRows} goal rows`);
          // allGameStats.push(data.gameStats);
          // const { goals, ...gameWithoutGoalsArray } = data.gameStats;
          // gamesNoGoals.push(gameWithoutGoalsArray);
          // allGoals = allGoals.concat(data.gameStats.goals);

          // add a delay
          await delay(3000);
        } catch (err) {
          console.log(chalk.yellow(`JSON [${file}]:`, err));
        }
      }
    }
    // fs.writeFileSync(`${JSON_LOC}/gameStats.json`, JSON.stringify(allGameStats), err => {});
    // fs.writeFileSync(`${JSON_LOC}/goalStats.json`, JSON.stringify(allGoals), err => {});
    // fs.writeFileSync(`${JSON_LOC}/gameStats_noGoals.json`, JSON.stringify(gamesNoGoals), err => {});
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
    const { id: gameId, score, teamSize, playlist, goals, time, frames, length, map, serverName } = replayJson.gameMetadata;
    const { team0Score, team1Score } = score;
    
    if (playlist !== 'CUSTOM_LOBBY') {
      reject('not CUSTOM_LOBBY playlist, not RLL?');
    }
    const retData = {};
    
    retData.team0Score = !!team0Score ? team0Score : 0;
    retData.team1Score = !!team1Score ? team1Score : 0;
    retData.teamSize = teamSize;
    
    const { players, teams, gameStats, mutators } = replayJson;
    const { ballStats, hits, neutralPossessionTime } = gameStats;
    
    // check mutators -- ignore if needed
    //  ballType: DEFAULT, BASKETBALL, PUCK, CUBEBALL, BREAKOUT
    //  gameMutatorIndex: -1 or 0? not sure what this means
    if (mutators.ballType !== 'DEFAULT') {
      reject('not DEFAULT ballType, not RLL');
    }

    const actualPlayers = players.filter((p) => !!p.score);

    const playersWithTeams = actualPlayers.map((player) => {
      const team = PLAYER_TEAM_MAP[player.name.toLowerCase()];
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
    
    retData.playerStats = finalPlayerStats.sort((a, b) => a.isOrange - b.isOrange);

    /**
     * get more info about goals
     * - Game ID
     * - Team, Opp Team
     * - Player
     * - Score before goal
     * - OT goal?
     * - Game Winner?
     * - Season
     * - Time in game
     * 
     */
    const gameTime = new Date(parseInt(time, 10) * 1000); // convert unix seconds timestamp to Date
    const fps = frames / length; // random example replay has this as about 32
    let team0RunningScore = 0;
    let team1RunningScore = 0;
    let probablyOT = false;
    const goalsData = goals.map((goal, idx) => {
      const { frameNumber, playerId: playerIdObj } = goal;
      const { id: playerId } = playerIdObj;
      const goalWithStats = {
        frameNumber,
        playerId,
      };

      const curPlayer = playersWithTeams.find((player) => player.id === playerId);
      const { name, teamName, oppTeam, isOrange } = curPlayer;
      goalWithStats.teamName = teamName;
      goalWithStats.oppTeamName = oppTeam;
      goalWithStats.playerName = name;
      goalWithStats.playerId = playerId;

      const timeOfGoal = Math.round(frameNumber / fps);
      goalWithStats.timeOfGoal = timeOfGoal;

      goalWithStats.timeOfGame = gameTime;

      goalWithStats.teamScoreBeforeGoal = !!isOrange ? team1RunningScore : team0RunningScore;
      goalWithStats.oppScoreBeforeGoal = !!!isOrange ? team1RunningScore : team0RunningScore;

      const prevGoalTotal = team0RunningScore + team1RunningScore;
      const isLastGoal = (idx + 1) === goals.length;

      const goalHit = hits.find((hit) => (
        hit.playerId.id === playerId
        && hit.frameNumber < frameNumber
        && !!hit.goal
        && (hit.goalNumber === prevGoalTotal || (hit.goalNumber === -1 && isLastGoal))
      ));
      goalWithStats.distanceToGoal = goalHit ? goalHit.distanceToGoal : -1;
      goalWithStats.assisted = goalHit ? goalHit.assisted || false : false;
      goalWithStats.aerial = goalHit ? goalHit.aerial || false : false;

      // isOrange is 0 for team0 or 1 for team1
      team0RunningScore += (1 - isOrange);
      team1RunningScore += isOrange;
      const goalDiff = !!isOrange ? team1Score - team0Score : team0Score - team1Score;

      const isProbablyOTGoal = (goalDiff === 1 // scorer's team won by 1
        && isLastGoal // last goal of the game
        && timeOfGoal > 300 && (frameNumber > (frames - (fps * 3)))); // late in game
      goalWithStats.isProbablyOTGoal = goalHit
        ? goalHit.goalNumber === -1 || isProbablyOTGoal
        : isProbablyOTGoal;

      if (goalWithStats.isProbablyOTGoal) {
        probablyOT = true;
      }
      goalWithStats.season = parseInt(SEASON_NUMBER, 10);
      goalWithStats.gameId = gameId;
      
      return goalWithStats;
    });
    // console.log(goalsData);

    retData.teamStats = teams;
    // gameStats don't look particularly interesting, but they're there if we want
    // retData.gameStats = gameStats;
    const unevenTeams = teams[0].playerIds.length !== teams[1].playerIds.length;
    
    const numAerials = hits.map((hit) => hit.aerial ? 1 : 0).reduce((accum, cur) => accum + cur);

    /*
      JPN   Asia East
      ASC   Asia SE-Mainland
      ASM   Asia SE-Maritime
      ME    Middle East
      OCE   Oceania
      SAF   South Africa
      EU    Europe
      USE   US-East
      USW   US-West
      SAM   South America
    */
    let serverRegion = serverName.slice(0, 3);
    if (serverRegion.startsWith('EU') || serverRegion.startsWith('ME')) {
      serverRegion = serverRegion.slice(0, 2);
    }

    retData.gameStats = {
      goals: goalsData,
      gameId,
      avgBallSpeed: ballStats.averages.averageSpeed,
      totalAerials: numAerials,
      neutralPossessionTime,
      team0: team0MaxTeam,
      team1: team1MaxTeam,
      team0Score: team0Score,
      team1Score: team1Score,
      winningTeam: team0Score > team1Score ? team0MaxTeam : team1MaxTeam,
      losingTeam: team1Score > team0Score ? team0MaxTeam : team1MaxTeam,
      startTime: time,
      gameLength: length,
      map,
      probablyOT,
      serverRegion,
    };

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

function updateSheet(data) {
  return new Promise((resolve, reject) => {
    const { 
      GOOGLE_SERVICE_ACCOUNT_EMAIL: email,
      GOOGLE_PRIVATE_KEY: privateKey,
      GOOGLE_SHEETS_SHEET_ID: sheetId,
     } = process.env;

    try {
      const doc = new GoogleSpreadsheet(sheetId);
      doc.useServiceAccountAuth({
        client_email: email,
        private_key: privateKey.replace(/\\n/g, '\n'),
      }).then(() => {
        doc.loadInfo().then(async () => {
          /**
           * 0: Standings
           * 1: Schedule
           * 2: Leaderboards
           * 3: Playoff Bracket
           * 4: Players
           * 5: Roster
           * 6: Stats
           * 7: EXPORT
           * 8: ROLES*
           * 
           * *ROLES removed S4
           */
          // console.log(doc.sheetsByTitle["Stats"]);
          // const playersSheet = doc.sheetsByIndex[4];
          // const rolesSheet = doc.sheetsByIndex[8];
          // const rostersSheet = doc.sheetsByIndex[5];
          // const standingsSheet = doc.sheetsByIndex[0];
          const scheduleSheet = doc.sheetsByTitle["ScheduleRows"]; // doc.sheetsByIndex[1];
          // const statsSheet = doc.sheetsByTitle["Stats"]; // doc.sheetsByIndex[6];
          const gameStatsSheet = doc.sheetsByTitle["GameStats"];
          const goalStatsSheet = doc.sheetsByTitle["GoalStats"];

          let scheduleRows = await scheduleSheet.getRows();
          // filter to completed games
          scheduleRows = scheduleRows.filter((row) => parseInt(row.GAME_COMPLETE, 10) === 1);

          // const statsRows = await statsSheet.getRows();
          // const statsLastGN = statsRows[statsRows.length - 1] ? statsRows[statsRows.length - 1].GN : -1;
          // CUR_GAMENUM = statsLastGN > CUR_GAMENUM ? parseInt(statsLastGN, 10) + 1 : CUR_GAMENUM;
          // add one row per player to the statsSheet
          // const { team0Score, team1Score, teamSize, playerStats, teamStats } = data;
          const { goals, ...gameWithoutGoalsArray } = data.gameStats;

          const gameRows = [];
          const goalRows = goals;
          gameRows.push(gameWithoutGoalsArray);
          try {
            const addGames = await gameStatsSheet.addRows(gameRows);
            const addGoals = await goalStatsSheet.addRows(goalRows);
            resolve({ gameRows: addGames.length, goalRows: addGoals.length });
            // resolve(gameRows.length); // TODO: remove after including sheets update
          } catch (err) {
            console.error(chalk.redBright('ERROR adding rows'));
            reject(err);
          }
        });
      });
    } catch (e) {
      console.error('Error updating google sheet', e);
      reject(e);
    }
  });
}

const outputGameStats = (data) => {
  const { gameStats } = data;
  console.log(gameStats);
}
