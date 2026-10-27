import { GameEngine } from "../types.js";
import { SnakeGameEngine } from "./snake.js";
import { WordleGameEngine } from "./wordle.js";
import { TypingGameEngine } from "./typing.js";
import { Game2048Engine } from "./game2048.js";
import { MathSprintEngine } from "./math.js";
import { CaptchaEngine } from "./captcha.js";
import { MinesweeperEngine } from "./minesweeper.js";
import { FrogGameEngine } from "./frog.js";
import { doomEvent } from "./doom.js";

// Global registry of game engines
const registry = new Map<string, GameEngine<any, any, any>>();

// Register engines
const snakeEngine = new SnakeGameEngine();
const wordleEngine = new WordleGameEngine();
const typingEngine = new TypingGameEngine();
const game2048Engine = new Game2048Engine();
const mathEngine = new MathSprintEngine();
const captchaEngine = new CaptchaEngine();
const minesweeperEngine = new MinesweeperEngine();
const frogEngine = new FrogGameEngine();

registry.set(snakeEngine.gameId, snakeEngine);
registry.set(wordleEngine.gameId, wordleEngine);
registry.set(typingEngine.gameId, typingEngine);
registry.set(game2048Engine.gameId, game2048Engine);
registry.set(mathEngine.gameId, mathEngine);
registry.set(captchaEngine.gameId, captchaEngine);
registry.set(minesweeperEngine.gameId, minesweeperEngine);
registry.set(frogEngine.gameId, frogEngine);

// Doom is metadata-only: it has no seeded simulation, so its runs are verified
// from a recorded demo rather than by replaying inputs. See games/doom.ts.
registry.set(doomEvent.gameId, doomEvent);

export function getGameEngine(gameId: string): GameEngine<any, any, any> | undefined {
  return registry.get(gameId);
}

export function getAllGameEngines(): GameEngine<any, any, any>[] {
  return Array.from(registry.values());
}
