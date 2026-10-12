module.exports = {
  root: true,
  extends: ['expo'],
  ignorePatterns: ['/node_modules', '/.expo', '/dist'],
  overrides: [
    {
      // The service worker runs in its own global scope (self, caches, clients), not a browser
      // window or Node — plain `env: browser` doesn't cover it.
      files: ['public/sw.js'],
      env: { serviceworker: true, browser: true },
    },
  ],
};
