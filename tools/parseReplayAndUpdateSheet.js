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
let CUR_GAMEWEEK = -1;

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

          const { statRows, gameRows, goalRows } = await updateSheet(data, file.slice(0, -5));
          console.log('Inserted', chalk.green(statRows), 'stat rows\t', chalk.green(gameRows), 'game rows\t', chalk.green(goalRows), 'goal rows');
          console.log();

          /** for writing stats to files */
          // allGameStats.push(data.gameStats);
          // const { goals, ...gameWithoutGoalsArray } = data.gameStats;
          // gamesNoGoals.push(gameWithoutGoalsArray);
          // allGoals = allGoals.concat(data.gameStats.goals);

          // console.log(data.playerStats.map((p) => `${JSON.stringify(p.stats.demoStats)}: ${p.name}`));

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
    const { id: gameId, score, teamSize, playlist, goals, demos, time, frames, length, map, serverName } = replayJson.gameMetadata;
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
     * stupid missile goal celebration ruins the demo stats
     * - fix by removing demos where the attacker and victim are the same ID
     */
    const realDemos = [];
    if (demos) {
      demos.forEach((demo) => {
        if (demo.attackerId.id !== demo.victimId.id) {
          realDemos.push(demo);
        }
      });
    }
    console.log('DEMOS\t', demos ? demos.length : 0, ' vs ', realDemos.length);
    const finalPlayerStatsWithDemos = realDemos && realDemos.length > 0
      ? finalPlayerStats.map((p) => {
        const numDemos = realDemos.filter((d) => d.attackerId.id === p.id);
        const numTaken = realDemos.filter((d) => d.victimId.id === p.id);
        const numDemosInflicted = numDemos ? numDemos.length : 0;
        const numDemosTaken = numTaken ? numTaken.length : 0;
        p.stats.demoStats = {
          numDemosInflicted,
          numDemosTaken
        };

        return p;
      })
      : finalPlayerStats;
    
    // rename bots to BOT 1, 2, 3
    let teamOrange = finalPlayerStatsWithDemos.filter((p) => !!p.isOrange).sort((a, b) => a.name - b.name);
    let teamBlue = finalPlayerStatsWithDemos.filter((p) => !!!p.isOrange).sort((a, b) => a.name - b.name);
    let botNum = 1;
    teamOrange = teamOrange.map((p) => {
      if (p.isBot && p.teamName === p.origTeam) {
        p.name = `BOT #${botNum}`;
        botNum++;
      }
      return p;
    });
    botNum = 1;
    teamBlue = teamBlue.map((p) => {
      if (p.isBot && p.teamName === p.origTeam) {
        p.name = `BOT #${botNum}`;
        botNum++;
      }
      return p;
    });
    const realFinalPlayerStats = teamOrange.concat(teamBlue);
    retData.playerStats = realFinalPlayerStats.sort((a, b) => a.isOrange - b.isOrange);

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

function updateSheet(data, gameId) {
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
          const statsSheet = doc.sheetsByTitle["Stats"]; // doc.sheetsByIndex[6];
          
          const gameStatsSheet = doc.sheetsByTitle["GameStats"];
          const goalStatsSheet = doc.sheetsByTitle["GoalStats"];
          const { goals, ...gameWithoutGoalsArray } = data.gameStats;
          
          const goalRows = goals;
          const gameRows = [];
          gameRows.push(gameWithoutGoalsArray);

          let scheduleRows = scheduleSheet ? await scheduleSheet.getRows() : [];
          // filter to completed games
          scheduleRows = scheduleRows.filter((row) => parseInt(row.GAME_COMPLETE, 10) === 1);

          const statsRows = await statsSheet.getRows();
          const statsLastGN = statsRows[statsRows.length - 1] ? statsRows[statsRows.length - 1].GN : -1;
          if (IS_COMBINE) {
            CUR_GAMENUM = statsLastGN > CUR_GAMENUM ? parseInt(statsLastGN, 10) + 1 : CUR_GAMENUM;
          }
          // add one row per player to the statsSheet
          const { team0Score, team1Score, teamSize, playerStats, teamStats } = data;

          const winningTeam = team0Score > team1Score ? 0 : 1;
          const mvp = playerStats.filter((player) => player.isOrange === winningTeam).reduce((prev, cur) => (prev.score > cur.score) ? prev : cur);

          const team0 = playerStats.filter((player) => player.isOrange === 0);
          const team1 = playerStats.filter((player) => player.isOrange === 1);

          const team0TotScore = team0.map((p) => p.score).reduce((accum, cur) => accum + cur);
          const team1TotScore = team1.map((p) => p.score).reduce((accum, cur) => accum + cur);

          // get all (unique) GNs that have already been inserted, so we can try to avoid reusing when teams/scorelines match multiple times
          const allGNs = statsRows.map((row) => row.GN).filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => parseInt(y, 10) - parseInt(x, 10));
          // console.log(allGNs);

          const statRows = [];

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

            const teamScore = !!isOrange ? team1Score : team0Score;
            const oppScore = !!!isOrange ? team1Score : team0Score;

            let gameType = 'RS';
            // finish getting game ID
            // find game between these teams
            const currentGame = scheduleRows.find((row) => {
              // eliminate GNs that are already in the sheet
              if (allGNs.indexOf(row.GAME) > -1) {
                return false;
              }

              const isTeamA = row.TM_A.toUpperCase() === (teamName || '').toUpperCase();
              const isTeamB = row.TM_B.toUpperCase() === (teamName || '').toUpperCase();
              const oppTeamB = row.TM_B.toUpperCase() === (oppTeam || '').toUpperCase();
              const oppTeamA = row.TM_A.toUpperCase() === (oppTeam || '').toUpperCase();
              
              if (isTeamA && oppTeamB) {
                return (parseInt(row.TM_A_SCR, 10) === parseInt(teamScore, 10) && parseInt(row.TM_B_SCR, 10) === parseInt(oppScore, 10));
              } else if (isTeamB && oppTeamA) {
                return (parseInt(row.TM_B_SCR, 10) === parseInt(teamScore, 10) && parseInt(row.TM_A_SCR, 10) === parseInt(oppScore, 10));
              }
              return false;
            });
            if (currentGame) {
              CUR_GAMENUM = parseInt(currentGame.GAME, 10);
              CUR_GAMEWEEK = parseInt(currentGame.GAMEWEEK, 10);
              gameType = currentGame.TYPE;
            } else {
              console.log('GN not found, using ', CUR_GAMENUM);
              console.log(CUR_GAMENUM, '\t', teamScore, teamName, 'vs', oppTeam, oppScore, '\t', (PLAYER_RLNAME_MAP[name.toLowerCase()] || name).toUpperCase());
            }

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
            
            // const isSub = !isBot && (teamName !== origTeam);
            const isSub = teamName !== origTeam;
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
              "TM SC": teamScore,
              "OPP SC": oppScore,
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
              // TYPE: isBot ? 'BOT' : (isSub ? 'SUB' : gameType), // gameType default is RS, could be PO, SN
              TYPE: (isSub ? 'SUB' : gameType), // gameType default is RS, could be PO, SN
              "Win/Loss": winner ? 'Win' : 'Loss',
              "%Team Score": percentOfTeam,
              GW: CUR_GAMEWEEK,
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
              "GAME ID": gameId,
            };

            // console.log(statRow);
            // console.log(CUR_GAMENUM, '\t', teamScore, teamName, 'vs', oppTeam, oppScore, '\t', (PLAYER_RLNAME_MAP[name.toLowerCase()] || name).toUpperCase());
            statRows.push(statRow);
          }
          try {
            const addStats = await statsSheet.addRows(statRows);
            const addGames = await gameStatsSheet.addRows(gameRows);
            const addGoals = await goalStatsSheet.addRows(goalRows);
            console.log(chalk.greenBright(`\tGN: ${CUR_GAMENUM}`));
            if (IS_COMBINE) {
              CUR_GAMENUM += 1;
            } else {
              CUR_GAMENUM = -1;
            }
            resolve({ statRows: addStats.length, gameRows: addGames.length, goalRows: addGoals.length });

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
