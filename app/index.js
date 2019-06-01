const {app, Menu, BrowserWindow, ipcMain, Tray} = require('electron');
app.setName('Standard Notes');

const path = require('path')
const windowStateKeeper = require('electron-window-state')
const shell = require('electron').shell;
const log = require('electron-log');
const Store = require('./javascripts/main/store.js');

import menuManager from './javascripts/main/menuManager.js'
import archiveManager from './javascripts/main/archiveManager.js';
import packageManager from './javascripts/main/packageManager.js';
import searchManager from './javascripts/main/searchManager.js';
import updateManager from './javascripts/main/updateManager.js';

ipcMain.on('initial-data-loaded', () => {
  archiveManager.beginBackups();
});

ipcMain.on('major-data-change', () => {
  archiveManager.performBackup();
})

process.on('uncaughtException', function (err) {
  console.log(err);
})

log.transports.file.level = 'info';

let darwin = process.platform === 'darwin'
let win, tray, trayContextMenu, willQuitApp = false;

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (!darwin) {
    app.quit()
  }
})

function createWindow () {

  // Load the previous state with fallback to defaults
  let winState = windowStateKeeper({
    defaultWidth: 1100,
    defaultHeight: 800
  })

  let iconLocation = path.join(__dirname, '/icon/Icon-512x512.png');

  // Defaults to false in store.js
  let useSystemMenuBar = Store.instance().get("useSystemMenuBar");

  // Create the window using the state information
  win = new BrowserWindow({
    'x': winState.x,
    'y': winState.y,
    'width': winState.width,
    'height': winState.height,
    'minWidth': 300,
    'minHeight': 400,
    show: false,
    icon: iconLocation,

    // We want hiddenInset on Mac. On Windows/Linux, doesn't seem to have an effect, but we'll default to it's original value before themed title bar changes were put in place.
    titleBarStyle: darwin || useSystemMenuBar ? 'hiddenInset' : null,

    // Will apply  to Windows and Linux only, since titleBarStyle takes precendence for mac. But we'll explicitely specifiy false for mac to be on the safe side
    frame: darwin ? false : useSystemMenuBar
  })

  searchManager.setWindow(win);
  archiveManager.setWindow(win);
  packageManager.setWindow(win);
  updateManager.setWindow(win);

  // Register listeners on the window, so we can update the state
  // automatically (the listeners will be removed when the window
  // is closed) and restore the maximized or full screen state
  winState.manage(win)
  // win.webContents.openDevTools()

  win.on('closed', (event) => {
    win = null
  })

  win.on('blur', (event) => {
    win.webContents.send("window-blurred", null);
    archiveManager.applicationDidBlur();
    tray.updateContextMenu('inactive');
  })

  win.on('focus', (event) => {
    win.webContents.send("window-focused", null);
    tray.updateContextMenu('active');
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  win.on('close', (e) => {
    if (willQuitApp) {
      /* the user tried to quit the app */
      win = null;
    } else if(darwin) {
      /* the user only tried to close the window */
      e.preventDefault();

      // Fixes Mac full screen issue where pressing close results in a black screen.
      if(win.isFullScreen()) {
        win.setFullScreen(false);
      }
      win.hide();
    }
  })

  let url = 'file://' + __dirname + '/index.html';
  if ('APP_RELATIVE_PATH' in process.env) {
    url = 'file://' + __dirname + '/' + process.env.APP_RELATIVE_PATH;
  }
  win.loadURL(url);

  // handle link clicks
  win.webContents.on('new-window', function(e, url) {
    if(!url.includes("file://")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // handle link clicks (this event is fired instead of
  // 'new-window' when target is not set to _blank)
  win.webContents.on('will-navigate', function(e, url) {
    if(!url.includes("file://")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

function createTrayIcon (mainWindow) {
  let icon;

  if (process.platform === 'darwin') {
    icon = path.join(__dirname, `/icon/IconTemplate.png`);
  } else {
    icon = path.join(__dirname, `/icon/Icon-256x256.png`);
  }

  tray = new Tray(icon);

  tray.toggleWindowVisibility = (visibility) => {
    if (mainWindow) {
      if (visibility === 'active') {
        mainWindow.hide();
      } else {
        mainWindow.show();

        // On some versions of GNOME the window may not be on top when restored.
        mainWindow.setAlwaysOnTop(true);
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
      }
    }
  };

  tray.updateContextMenu = (visibility) => {
    // NOTE: we want to have the show/hide entry available in the tray icon
    // context menu, since the 'click' event may not work on all platforms.
    // For details please refer to:
    // https://github.com/electron/electron/blob/master/docs/api/tray.md.
    trayContextMenu = Menu.buildFromTemplate([{
      id: 'toggleWindowVisibility',
      label: visibility === 'active' ? 'Hide' : 'Show',
      click: tray.toggleWindowVisibility.bind(this, visibility),
    },
    {
      type: 'separator'
    },
    {
      id: 'quit',
      label: 'Quit',
      click: app.quit.bind(app),
    }]);

    tray.setContextMenu(trayContextMenu);
  };

  tray.setToolTip('Standard Notes');
  return tray;
}

app.on('before-quit', () => willQuitApp = true);

app.on('activate', function() {

	if (!win) {
    createWindow();
	} else {
    win.show();
  }

  updateManager.checkForUpdate();
});

app.on('ready', function(){
  if(!win) {
    createWindow();
  } else {
    win.focus();
  }

  menuManager.loadMenu(win, archiveManager, updateManager);
  updateManager.onNeedMenuReload = () => {
    menuManager.reload();
  }

  createTrayIcon(win);
})

ipcMain.on("display-app-menu", (event, position) => {
  menuManager.popupMenu(position);
});
