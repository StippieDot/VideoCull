const { app } = require('electron');
const { configureAppProfile } = require('./profile-bootstrap');

try {
  const profileBootstrap = configureAppProfile(app);
  globalThis.__VIDEOCULL_PROFILE_BOOTSTRAP__ = profileBootstrap;
  require('./main');
} catch (error) {
  console.error('[profile-bootstrap] VideoCull could not initialize its profile:', error);
  app.exit(1);
}
