const { app, crashReporter, dialog } = require('electron');
const { configureAppProfile } = require('./profile-bootstrap');
const { acquireEditionGuard, closeEditionGuard } = require('./edition-guard');
const { ensureProfileStorageCompatibility } = require('./storage-compatibility');

async function bootstrap() {
  let editionGuard;
  try {
    editionGuard = await acquireEditionGuard({
      isPackaged: app.isPackaged,
      platform: process.platform,
      isE2E: process.env.VC_E2E_USE_DIST === '1',
    });
  } catch (error) {
    console.error('[edition-guard] VideoCull could not start:', error);
    dialog.showErrorBox('VideoCull could not start', error.message);
    app.exit(1);
    return;
  }

  let profileBootstrap;
  try {
    profileBootstrap = configureAppProfile(app);
  } catch (error) {
    console.error('[profile-bootstrap] VideoCull could not initialize its profile:', error);
    closeEditionGuard(editionGuard);
    app.exit(1);
    return;
  }

  try {
    ensureProfileStorageCompatibility(profileBootstrap.selectedPath);
  } catch (error) {
    console.error('[storage-compatibility] VideoCull refused to open the profile:', error);
    dialog.showErrorBox(
      'VideoCull cannot open this profile',
      error.userMessage || 'VideoCull could not verify that this profile is safe to open.',
    );
    closeEditionGuard(editionGuard);
    app.exit(1);
    return;
  }

  crashReporter.start({
    productName: 'VideoCull',
    uploadToServer: false,
    compress: false,
  });
  const crashDumpsPath = app.getPath('crashDumps');
  console.info(`[crash-reporter] Local crash dumps: ${crashDumpsPath}`);

  globalThis.__VIDEOCULL_EDITION_GUARD__ = editionGuard;
  globalThis.__VIDEOCULL_PROFILE_BOOTSTRAP__ = profileBootstrap;
  globalThis.__VIDEOCULL_CRASH_DUMPS_PATH__ = crashDumpsPath;
  require('./main');
}

void bootstrap().catch((error) => {
  console.error('[bootstrap] VideoCull could not start:', error);
  dialog.showErrorBox('VideoCull could not start', error.message);
  closeEditionGuard(globalThis.__VIDEOCULL_EDITION_GUARD__);
  app.exit(1);
});
