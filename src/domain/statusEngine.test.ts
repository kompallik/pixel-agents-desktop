import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { assessStatus } from './statusEngine.js';
import type { StatusInput } from './statusEngine.js';

interface StatusScenario {
  name: string;
  input: StatusInput;
  expected: { state: string; minConfidence: number };
}

const scenariosPath = path.resolve(__dirname, '../../fixtures/status-scenarios.json');
const scenarios: StatusScenario[] = JSON.parse(fs.readFileSync(scenariosPath, 'utf-8'));

describe('assessStatus', () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = assessStatus(scenario.input);
      expect(result.state).toBe(scenario.expected.state);
      expect(result.confidence).toBeGreaterThanOrEqual(scenario.expected.minConfidence);
    });
  }
});
