import { GameEngine } from "../types.js";
import { SnakeGameEngine } from "./snake.js";
import { WordleGameEngine } from "./wordle.js";
import { TypingGameEngine } from "./typing.js";
import { Game2048Engine } from "./game2048.js";

// Global registry of game engines
const registry = new Map<string, GameEngine<any, any, any>>();

// Register engines
const snakeEngine = new SnakeGameEngine();
const wordleEngine = new WordleGameEngine();
const typingEngine = new TypingGameEngine();
const game2048Engine = new Game2048Engine();

registry.set(snakeEngine.gameId, snakeEngine);
registry.set(wordleEngine.gameId, wordleEngine);
registry.set(typingEngine.gameId, typingEngine);
registry.set(game2048Engine.gameId, game2048Engine);

export function getGameEngine(gameId: string): GameEngine<any, any, any> | undefined {
  return registry.get(gameId);
}

export function getAllGameEngines(): GameEngine<any, any, any>[] {
  return Array.from(registry.values());
}
