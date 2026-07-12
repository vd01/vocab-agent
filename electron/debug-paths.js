const { app } = require('electron');
app.whenReady().then(() => {
  console.log('getAppPath:', app.getAppPath());
  console.log('exe:', app.getPath('exe'));
  console.log('cwd:', process.cwd());
  app.quit();
});
