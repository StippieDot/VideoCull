const { app } = require('electron');
const { configureAppProfile } = require('./profile-bootstrap');

function bootstrap() {
  let profileBootstrap;
  try {
    profileBootstrap = configureAppProfile(app);
  } catch (error) {
    console.error('[profile-bootstrap] VideoCull could not initialize its profile:', error);
    app.exit(1);
    return;
  }

  globalThis.__VIDEOCULL_PROFILE_BOOTSTRAP__ = profileBootstrap;
  require('./main');
}

bootstrap();
