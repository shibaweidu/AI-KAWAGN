module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.(t|j)s$": "ts-jest" },
  moduleNameMapper: { "^@ai-card/contracts$": "<rootDir>/../../../packages/contracts/src/index.ts" },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node"
};
