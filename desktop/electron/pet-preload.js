const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xiaobaPet', {
  dragStart(point) {
    ipcRenderer.send('pet:drag-start', point);
  },
  dragMove(point) {
    ipcRenderer.send('pet:drag-move', point);
  },
  dragEnd() {
    ipcRenderer.send('pet:drag-end');
  },
  openChat(url) {
    ipcRenderer.send('pet:open-chat', url);
  },
});
