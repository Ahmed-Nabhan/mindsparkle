const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite (web) imports a .wasm binary; Metro needs to treat it as an asset.
config.resolver.assetExts = Array.from(
  new Set([...(config.resolver.assetExts || []), 'wasm'])
);

module.exports = config;
