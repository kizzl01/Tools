"use strict";

function populateFileList(files) {
  const table = document.getElementById("file-list");
  let tableRow = createPopulatedElement("thead");
  const headerFileName = createPopulatedElement("th", "File name", "left");
  const headerFileSize = createPopulatedElement("th", "Size");
  const headerResolution = createPopulatedElement("th", "Quality");
  const headerFileTimestamp = createPopulatedElement("th", "Timestamp");
  const headerActions = createPopulatedElement("th", "");
  tableRow.append(headerFileName, headerFileSize, headerResolution, headerFileTimestamp, headerActions);
  table.appendChild(tableRow);

  for (const file of files) {
    tableRow = createPopulatedElement("tr");
    const fileNameCellDiv = createPopulatedElement("div", file.filename, "wide", "click", function (e) {
      const downloadId = file.downloadId;
      if (downloadId > 0) {
        openDownloadLocation(downloadId);
      }
    });
    const fileNameCell = createPopulatedElement("td", fileNameCellDiv);
    const fileSizeCell = createPopulatedElement("td", formatFileSize(file.filesize), "right");
    let resDiv;
    if (file.resolution) {
      let res;
      const maxAudioKbps = 320;
      if (file.filename.endsWith(".mp4") && file.resolution > maxAudioKbps) {
        res = `${file.resolution}p`;
      } else {
        res = `${file.resolution}kbps`;
      }
      resDiv = createPopulatedElement("div", res, `resBlock-small`);

    } else {
      resDiv = createPopulatedElement("div", "N/A");
    }
    const fileResolutionCell = createPopulatedElement("td", resDiv, "center");
    const fileTimestampCell = createPopulatedElement("td", formatDateTimestamp(file.timestamp));
    const fileDeleteCell = createPopulatedElement(
      "td",
      createPopulatedElement("div", "", "placeholder", "click", function (e) {
        const downloadId = file.downloadId;
        chrome.downloads.removeFile(downloadId, function (f) {
          // Remove the row from the list
          e.target.parentElement.parentElement.parentElement.removeChild(e.target.parentElement.parentElement);

          // Remove the item from storage
          removeFileFromList(downloadId);

          if (chrome.runtime.lastError) {
            console.log(`Failed to remove download '${downloadId}'. Reason: ${chrome.runtime.lastError.message}`);
          }
        });
      })
    );
    fileDeleteCell.setAttribute("title", "WARNING! This will delete the downloaded file from your computer.");
    tableRow.append(fileNameCell, fileSizeCell, fileResolutionCell, fileTimestampCell, fileDeleteCell);
    table.appendChild(tableRow);
  }
}

function openDownloadLocation(downloadId) {
  if (downloadId) {
    chrome.downloads.show(downloadId);
  }
}

function clearFileList() {
  const table = document.getElementById("file-list");
  table.parentElement.removeChild(table);
}

function removeFileFromList(downloadId) {
  chrome.storage.local.get("downloads", function (result) {
    if (result.downloads && result.downloads.files) {
      const index = result.downloads.files.findIndex((file) => file.downloadId === downloadId);
      result.downloads.files.splice(index, 1);
      chrome.storage.local.set({
        downloads: result.downloads,
      });
      if (result.downloads.files.length === 0) {
        const clearFileListElem = document.getElementById("clearFileList");
        if (clearFileListElem) {
          clearFileListElem.dispatchEvent(new Event("click"));
        }
      }
    }
  });
}

window.addEventListener("load", (event) => {
  chrome.storage.local.get("downloads", function (result) {
    if (result.downloads && result.downloads.files && result.downloads.files.length > 0) {
      const clearFileListElem = createPopulatedElement("div", "Clear list", null, "click", (e) => {
        chrome.storage.local.clear();
        window.close();
      });
      clearFileListElem.id = "clearFileList";
      document.getElementById("heading").appendChild(clearFileListElem);
      populateFileList(result.downloads.files);
    }
  });

  document.getElementById("paypal-logo").addEventListener("click", (e) => {
    chrome.tabs.create({url: "https://www.paypal.com/donate/?hosted_button_id=28G2ZL2SSM4VJ"});
    window.close();
  });
});
