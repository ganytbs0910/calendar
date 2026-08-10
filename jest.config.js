module.exports = {
  preset: 'react-native',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Several dependencies ship untranspiled ESM/TypeScript (react-native-iap,
  // react-native-vector-icons, …). The preset's default only exempts the core
  // react-native packages, so anything importing one of these failed to parse
  // before the test even ran. Widen it to the whole react-native family.
  transformIgnorePatterns: [
    'node_modules/(?!(?:jest-)?@?react-native)',
  ],
};
