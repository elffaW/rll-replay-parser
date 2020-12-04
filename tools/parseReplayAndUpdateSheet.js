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

(async () => {
  try {
    const files = await fs.promises.readdir(JSON_LOC);

    for (const file of files) {
      if (file.toLowerCase().endsWith('.json')) { // only JSON files
        try {
          const data = await getDataFromReplay(file);
          console.log(chalk.cyanBright(`got data, now save it [${file}]`));
          // console.log(JSON.stringify(data, null, 2));
          // console.log(data.playerStats.map((p) => `${p.name}:${p.teamName} [${p.maxTeam}]`));
          const numRows = await updateSheet(data);
          console.log(`Inserted ${numRows} data rows`);
        } catch (err) {
          console.log(chalk.yellow(`JSON [${file}]:`, err));
        }
      }
    }
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
    const { score, teamSize, playlist } = replayJson.gameMetadata;
    const { team0Score, team1Score } = score;

    if (playlist !== 'CUSTOM_LOBBY') {
      reject('not CUSTOM_LOBBY playlist, not RLL?');
    }
    const retData = {};

    retData.team0Score = !!team0Score ? team0Score : 0;
    retData.team1Score = !!team1Score ? team1Score : 0;
    retData.teamSize = teamSize;

    const { players, teams, /*gameStats,*/ mutators } = replayJson;
    
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

    retData.teamStats = teams;
    // gameStats don't look particularly interesting, but they're there if we want
    // retData.gameStats = gameStats;
    const unevenTeams = teams[0].playerIds.length !== teams[1].playerIds.length;

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
          // const playersSheet = doc.sheetsByIndex[4];
          // const rolesSheet = doc.sheetsByIndex[8];
          // const rostersSheet = doc.sheetsByIndex[5];
          // const standingsSheet = doc.sheetsByIndex[0];
          // const scheduleSheet = doc.sheetsByIndex[1];
          const statsSheet = doc.sheetsByIndex[6];

          const statsRows = await statsSheet.getRows();
          const statsLastGN = statsRows[statsRows.length - 1] ? statsRows[statsRows.length - 1].GN : -1;
          CUR_GAMENUM = statsLastGN > CUR_GAMENUM ? parseInt(statsLastGN, 10) + 1 : CUR_GAMENUM;
          // add one row per player to the statsSheet
          const { team0Score, team1Score, teamSize, playerStats, teamStats } = data;

          const winningTeam = team0Score > team1Score ? 0 : 1;
          const mvp = playerStats.filter((player) => player.isOrange === winningTeam).reduce((prev, cur) => (prev.score > cur.score) ? prev : cur);

          const team0 = playerStats.filter((player) => player.isOrange === 0);
          const team1 = playerStats.filter((player) => player.isOrange === 1);

          const team0TotScore = team0.map((p) => p.score).reduce((accum, cur) => accum + cur);
          const team1TotScore = team1.map((p) => p.score).reduce((accum, cur) => accum + cur);

          const gameRows = [];

          for (idx in playerStats) {
            const player = playerStats[idx];
            const {
              // id, // some places have player by id, but not using those yet
              name,
              isBot,
              isOrange,
              teamName,
              origTeam,
              oppTeam,
              goals = 0,
              assists = 0,
              saves = 0,
              shots = 0,
              score = 0,
              stats,
              timeInGame = 0,
            } = player;

            const {
              boost,
              distance,
              possession,
              positionalTendencies,
              averages,
              hitCounts,
              controller,
              speed,
              relativePositioning,
              // perPossessionStats, // not using; this one isn't always there
              ballCarries,
              kickoffStats,
              demoStats,
            } = stats;
            const winner = isOrange === winningTeam ? 1 : 0;
            const isMvp = mvp.name === name ? 1 : 0;
            const teamTotScore = !!isOrange ? team1TotScore : team0TotScore;
            const oppTotScore = !!!isOrange ? team1TotScore : team0TotScore;

            const playerTeam = teamStats.filter((t) => !!t.isOrange === !!isOrange)[0];
            const { timeClumped = 0 } = playerTeam.stats.centerOfMass || {};
            
            const isSub = !isBot && (teamName !== origTeam);
            const tmPercent = score / teamTotScore;
            let percentOfTeam = '<0.10';
            if (tmPercent > 0.75) {
              percentOfTeam = '>0.75';
            } else if (tmPercent > 0.50) {
              percentOfTeam = '>0.50';
            } else if (tmPercent > 0.33) {
              percentOfTeam = '>0.33';
            } else if (tmPercent > 0.25) {
              percentOfTeam = '>0.25';
            } else if (tmPercent > 0.10) {
              percentOfTeam = '>0.10';
            } else {
              percentOfTeam = '<0.10';
            }

            const { boostUsage = 0,
              numSmallBoosts = 0,
              numLargeBoosts = 0,
              wastedUsage = 0,
              averageBoostLevel = 0,
              numStolenBoosts = 0,
            } = boost;
            const { ballHitForward = 0, ballHitBackward = 0, timeCloseToBall = 0 } = distance;
            const { turnovers = 0, wonTurnovers = 0 } = possession || {};
            const {
              timeLowInAir = 0,
              timeHighInAir = 0,
              timeBehindBall = 0,
              timeInFrontBall = 0,
              timeOnWall = 0,
              timeInDefendingThird = 0,
              timeInNeutralThird = 0,
              timeInAttackingThird = 0,
            } = positionalTendencies;
            const { averageSpeed = 0, averageHitDistance = 0 } = averages;
            const { totalHits = 0, totalPasses = 0, totalDribbles = 0, totalAerials = 0, totalClears = 0 } = hitCounts || {};
            const { timeBallcam = 0 } = controller || {};
            const { timeAtSlowSpeed = 0, timeAtBoostSpeed = 0, timeAtSuperSonic = 0 } = speed;
            const { timeMostForwardPlayer = 0, timeMostBackPlayer = 0, timeBetweenPlayers = 0 } = relativePositioning;
            const { totalCarries = 0, totalCarryDistance = 0 } = ballCarries || {};
            const { numTimeFirstTouch = 0, numTimeAfk = 0 } = kickoffStats;
            const { numDemosInflicted = 0, numDemosTaken = 0 } = demoStats || {};
            
            // CALCULATED STATS
            const usefulHits = totalPasses + totalClears + shots + goals + saves;

            // each stat row
            const statRow = {
              GN: CUR_GAMENUM,
              PLAYER: (PLAYER_RLNAME_MAP[name.toLowerCase()] || name).toUpperCase(),
              TM: (teamName || '').toUpperCase(),
              OPP: (oppTeam || '').toUpperCase(),
              GP: 1,
              "TM SC": !!isOrange ? team1Score : team0Score,
              "OPP SC": !!!isOrange ? team1Score : team0Score,
              SCORE: score,
              G: goals,
              A: assists,
              SV: saves,
              SH: shots,
              MVP: isMvp,
              PTS: parseInt(goals, 10) + parseInt(assists, 10),
              W: winner,
              L: 1 - winner,
              "TM TOT SC": teamTotScore,
              "TM AVG SCORE": teamTotScore / teamSize,
              "TM%": tmPercent,
              RATING: score / (teamTotScore / teamSize),
              TYPE: isBot ? 'BOT' : (isSub ? 'SUB' : 'RS'),
              "Win/Loss": winner ? 'Win' : 'Loss',
              "%Team Score": percentOfTeam,
              "OPP TOT SCORE": oppTotScore,
              RATIO: teamTotScore / oppTotScore,
              TOUCHES: totalHits,
              "AIR TIME HIGH": timeHighInAir,
              "AIR TIME LOW": timeLowInAir,
              "AIR HITS": totalAerials,
              "DEMOS": numDemosInflicted,
              "DEMOS TAKEN": numDemosTaken,
              "FIRST TOUCHES": numTimeFirstTouch,
              "KICKOFF AFK": numTimeAfk,
              "CLEARS": totalClears,
              "PASSES": totalPasses,
              "TURNOVERS": turnovers,
              "TURNOVERS WON": wonTurnovers,
              "BOOST USAGE": boostUsage,
              "SMALL BOOSTS": numSmallBoosts,
              "LARGE BOOSTS": numLargeBoosts,
              "WASTED BOOST": wastedUsage,
              "AVG BOOST": averageBoostLevel,
              "STOLEN BOOSTS": numStolenBoosts,
              "AVG SPEED": averageSpeed,
              "AVG HIT DISTANCE": averageHitDistance,
              "SLOW SPEED TIME": timeAtSlowSpeed,
              "BOOST SPEED TIME": timeAtBoostSpeed,
              "SUPERSONIC TIME": timeAtSuperSonic,
              "BALLCAM TIME": timeBallcam,
              "TIME ON WALL": timeOnWall,
              "TIME MOST FORWARD": timeMostForwardPlayer,
              "TIME MOST BACK": timeMostBackPlayer,
              "TIME BETWEEN": timeBetweenPlayers,
              "TIME BEHIND BALL": timeBehindBall,
              "TIME IN FRONT BALL": timeInFrontBall,
              "BALL HIT FORWARD": ballHitForward,
              "BALL HIT BACKWARD": ballHitBackward,
              "TIME CLOSE TO BALL": timeCloseToBall,
              "BALL CARRIES": totalCarries,
              "CARRY DISTANCE": totalCarryDistance,
              "DRIBBLE HITS": totalDribbles,
              "TIME CLUMPED": timeClumped,
              "USEFUL HITS": usefulHits,
              "TIME IN GAME": timeInGame,
              "TIME DEF THIRD": timeInDefendingThird,
              "TIME NEUTRAL THIRD": timeInNeutralThird,
              "TIME ATTACK THIRD": timeInAttackingThird,
            };

            // console.log(statRow);
            gameRows.push(statRow);
          }
          try {
            const addRows = await statsSheet.addRows(gameRows);
            CUR_GAMENUM += 1;
            resolve(addRows.length);
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
