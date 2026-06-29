
const { app, BrowserWindow, WebContentsView } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600, transparent: true, frame: false });
  win.loadURL('data:text/html,<html><body style=\'background: blue; border-radius: 20px; overflow: hidden; margin: 0; padding: 20px;\'><h1 style=\'color: white;\'>BrowserWindow</h1></body></html>');
  
  const view = new WebContentsView();
  win.contentView.addChildView(view);
  view.setBounds({ x: 50, y: 50, width: 300, height: 300 });
  view.setBackgroundColor('#00000000'); // Transparent
  
  view.webContents.loadURL('https://example.com');
  view.webContents.on('did-finish-load', () => {
    view.webContents.insertCSS('html, body { border-radius: 50px; overflow: hidden; background-color: rgba(255, 0, 0, 0.5) !important; margin: 0; }');
  });
});
