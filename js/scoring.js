// Standard tennis scoring state machine: points -> games (deuce/ad or no-ad)
// -> sets (with tiebreak at gamesPerSet-all) -> match. Sides are 'player'/'ai'.
(function (global) {
  'use strict';

  function other(side) {
    return side === 'player' ? 'ai' : 'player';
  }

  class TennisMatch {
    constructor(config) {
      this.config = Object.assign(
        { bestOfSets: 1, gamesPerSet: 6, tiebreakTo: 7, noAd: false, firstServer: 'player' },
        config
      );
      this.server = this.config.firstServer;
      this.setsWon = { player: 0, ai: 0 };
      this.completedSets = []; // [{player, ai}]
      this.games = { player: 0, ai: 0 };
      this.points = { player: 0, ai: 0 };
      this.inTiebreak = false;
      this.tiebreakPoints = { player: 0, ai: 0 };
      this.matchOver = false;
      this.winner = null;
      this.setsToWin = Math.floor(this.config.bestOfSets / 2) + 1;
    }

    getServer() {
      return this.server;
    }

    // 'deuce' (right court) or 'ad' (left court), from the server's perspective.
    getServeCourt() {
      const total = this.inTiebreak
        ? this.tiebreakPoints.player + this.tiebreakPoints.ai
        : this.points.player + this.points.ai;
      return total % 2 === 0 ? 'deuce' : 'ad';
    }

    getPointLabel(side) {
      if (this.inTiebreak) return String(this.tiebreakPoints[side]);
      const labels = ['0', '15', '30', '40'];
      const p = this.points[side];
      const o = this.points[other(side)];
      if (p >= 3 && o >= 3) {
        if (this.config.noAd) return '40';
        if (p === o) return 'DEUCE';
        return p > o ? 'AD' : '';
      }
      return labels[Math.min(p, 3)];
    }

    isDeuce() {
      if (this.inTiebreak || this.config.noAd) return false;
      return this.points.player >= 3 && this.points.ai >= 3 && this.points.player === this.points.ai;
    }

    // Awards one point to `side`. Returns { events, side } where events is a
    // subset of ['point','game','set','match'] describing what just concluded.
    awardPoint(side) {
      if (this.matchOver) return { events: [], side };
      const events = ['point'];

      if (this.inTiebreak) {
        this.tiebreakPoints[side]++;
        const p = this.tiebreakPoints[side];
        const o = this.tiebreakPoints[other(side)];
        if (p >= this.config.tiebreakTo && p - o >= 2) {
          this._winGame(side, events, true);
        }
      } else {
        this.points[side]++;
        const p = this.points[side];
        const o = this.points[other(side)];
        const wins = this.config.noAd ? p >= 4 : p >= 4 && p - o >= 2;
        if (wins) this._winGame(side, events, false);
      }

      return { events, side };
    }

    _winGame(side, events, wasTiebreak) {
      events.push('game');
      this.games[side]++;
      this.points = { player: 0, ai: 0 };
      this.tiebreakPoints = { player: 0, ai: 0 };
      this.inTiebreak = false;
      this.server = other(this.server);

      const gp = this.games[side];
      const go = this.games[other(side)];
      const target = this.config.gamesPerSet;
      let setWon = wasTiebreak ? true : gp >= target && gp - go >= 2;
      if (!setWon && gp === target && go === target) {
        this.inTiebreak = true; // trigger tiebreak next point
      }
      if (setWon) {
        this._winSet(side, events);
      }
    }

    _winSet(side, events) {
      events.push('set');
      this.completedSets.push({ player: this.games.player, ai: this.games.ai });
      this.setsWon[side]++;
      this.games = { player: 0, ai: 0 };
      if (this.setsWon[side] >= this.setsToWin) {
        this.matchOver = true;
        this.winner = side;
        events.push('match');
      }
    }

    getSetsSummary() {
      const sets = this.completedSets.map((s) => ({ player: s.player, ai: s.ai }));
      sets.push({ player: this.games.player, ai: this.games.ai, current: true });
      return sets;
    }
  }

  global.TennisMatch = TennisMatch;
  global.tennisOther = other;
})(window);
