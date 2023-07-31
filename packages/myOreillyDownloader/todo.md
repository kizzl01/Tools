## Enable downloading from multiple tabs
###### [7 Dec 2022]
---
Currently, the arrays to download batches of videos and captions are in the content script. They need to move to the backround script, along with the tab id that sent the array to the background script.

Possible structure of the download queues in the background script:
```
[{
  tabId: 000,
  files: [...]
}, {
  tabId: 001,
  files: [...]
},
...]
```
...or not. Maybe alter each item in the array passed in to have the relevant tab id?

Once received in the background script, a separate function should start processing the array of files.