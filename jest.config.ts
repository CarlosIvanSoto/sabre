import { createDefaultPreset, type JestConfigWithTsJest } from 'ts-jest';

const jestConfig: JestConfigWithTsJest = {
  // preset: 'ts-jest',
  // verbose: true,
  // // testEnvironment: 'node',
  // prettierPath: null,
  ...createDefaultPreset(),
};

export default jestConfig;