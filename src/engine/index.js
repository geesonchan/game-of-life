// engine 层统一出口
export { LifeEngine } from './board.js'
export {
  compileRule, parseBS, bsToClauses, lifeRule, toBSNotation,
  stateName, stateFromName, DEAD, ALIVE
} from './rules.js'
export { mulberry32, randomSeed, normalizeSeed } from './prng.js'
