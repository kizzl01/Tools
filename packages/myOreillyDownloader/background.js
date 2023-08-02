import data from "./config.js";
import ConvertApi from "./node_modules/convertapi-js";
const TWENTY_MINUTES = 20 * 60 * 1000;

let courseTitle;
let folderName;
let tabId;
let type;
const configData = data.ConvertApi;
let epubFileList = [];
console.log("background.js start");
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.clear();
  // chrome.tabs.create({ url: "https://netdev.co.za/blog/ebook-downloads-for-my-oreilly-downloader/" });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (
    delta.state?.current === chrome.downloads.State.COMPLETE ||
    delta.state?.current === chrome.downloads.State.INTERRUPTED
  ) {
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: "notifyDownloadComplete",
        downloadId: delta.id,
        state: delta.state.current,
        type,
      });
    }
  }
});

(async () => {
  console.log("background.js async method call");
  await chrome.runtime.onMessage.addListener(
    async (message, sender, sendResponse) => {
      tabId = sender.tab.id;

      if (message.action === "sendBadDownloadUrlMessage") {
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            action: "notifyDownloadComplete",
            downloadId: 0,
            state: chrome.downloads.State.INTERRUPTED,
            type,
          });
        }
        return true;
      }
      if (message.action === "startDownloadingEpub") {
        epubFileList.length = 0;

        const ebookApiUrl = `${message.origin}/api/v2/epubs/`;
        const urn = Object.keys(message.tableOfContents)[0];

        const bookRes = await fetch(`${ebookApiUrl}${urn}/`);
        const bookJson = await bookRes.json();

        chrome.tabs.sendMessage(tabId, {
          action: "updateEpubMessage",
          text: "Getting book details and file list...",
        });

        const filesUrl = bookJson.files;
        let filesRes = await fetch(`${filesUrl}?limit=1`);
        let filesJson = await filesRes.json();

        const fileCount = filesJson.count;
        filesRes = await fetch(`${filesUrl}?limit=${fileCount}`);
        filesJson = await filesRes.json();

        const spineUrl = bookJson.spine;
        const spineRes = await fetch(`${spineUrl}?limit=2`);
        const spineJson = await spineRes.json();

        const lastSpineResult = spineJson.results[1];
        const resultUrl = lastSpineResult.url;

        const lastFileResult = await fetch(`${resultUrl}`);
        const lastFileJson = await lastFileResult.json();
        const stylesheetsToUse = lastFileJson.related_assets.stylesheets;
        for (let stylesheetIndex in stylesheetsToUse) {
          stylesheetsToUse[stylesheetIndex] = stylesheetsToUse[
            stylesheetIndex
          ].replace(filesUrl, "");
        }

        // Add this file first, so it's in the zip file's offset 0 (a requirement for epubs)
        const mimetypeFile = {
          filename: "mimetype",
          mediaType: "application/epub+zip",
          simpleType: "text",
          contents: fflate.strToU8("application/epub+zip"),
        };
        epubFileList.push(mimetypeFile);

        const array_chunks = (array, chunk_size) =>
          Array(Math.ceil(array.length / chunk_size))
            .fill()
            .map((_, index) => index * chunk_size)
            .map((begin) => array.slice(begin, begin + chunk_size));

        const chunks = array_chunks(filesJson.results, 25);

        for (let i = 0; i < chunks.length; i++) {
          chrome.tabs.sendMessage(tabId, {
            action: "updateEpubMessage",
            text: `Downloading batch ${i + 1} of ${chunks.length
              }, please wait...`,
          });
          // hier werden die epub-file segmente gesammelt
          try {
            await Promise.all(
              await chunks[i].map(async (file) => {
                const resp = await fetch(file.url);
                const data = await resp.arrayBuffer();
                epubFileList.push({
                  filename: file.full_path,
                  mediaType: file.media_type,
                  contents: new Uint8Array(data),
                });
              })
            );
          } catch (err) {
            epubFileList.length = 0;
            chrome.tabs.sendMessage(tabId, {
              action: "updateEpubMessage",
              text: "Failed to download all files needed for ePub book",
            });
            sendResponse({ completed: true, error: err });
            return true;
          }
        }

        const overrideCssUrl = `${message.origin}/files/public/epub-reader/override_v1.css`;
        const overrideCssResp = await fetch(overrideCssUrl);
        const overrideCssData = await overrideCssResp.arrayBuffer();
        epubFileList.push({
          filename: "/override_v1.css",
          mediaType: "text/css",
          contents: new Uint8Array(overrideCssData),
        });
        for (let i = 1; i < epubFileList.length; i++) {
          if (
            epubFileList[i].mediaType === "application/xhtml+xml" ||
            epubFileList[i].mediaType === "text/html"
          ) {
            let fileText = fflate.strFromU8(epubFileList[i].contents);
            fileText = fileText.replaceAll(`/api/v2/epubs/${urn}/files/`, "");

            const closeTag = (text, tag) =>
              text.replace(tag, tag.replace(">", "/>"));

            // Get the relative pathing for resources
            const path = Array.from(epubFileList[i].filename).reduce(
              (a, b) => (b === "/" ? a + "../" : a),
              ""
            );

            // Find and fix tags that break the XHTML spec
            const thingsToFind = ["img", "br", "hr", "col"];
            for (let tag of thingsToFind) {
              const regexToFind = new RegExp(
                `(?:<${tag}(?:\\s[\\w\\:]+=(?:"[^"]*"|[^>])+\\s*)*)(?<!\\/)>`,
                "gim"
              );
              const thingsToFix = [...fileText.matchAll(regexToFind)];

              for (let j = 0; j < thingsToFix.length; j++) {
                let temp = thingsToFix[j][0];
                fileText = closeTag(fileText, thingsToFix[j][0]);

                temp = temp.replace(">", "/>");
                fileText = fileText.replace(
                  temp,
                  temp.replace('src="', `src="${path}`)
                );
              }
            }

            // Get all CSS
            const cssHrefs = stylesheetsToUse.map(
              (x) =>
                `<link rel="stylesheet" type="text/css" href="${path}${x}"/>`
            );

            // Check if the content is already XHTML wrapped
            const xhtmlTemplate =
              fileText.indexOf("<?xml version=") >= 0
                ? fileText
                : `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xml:lang="${bookJson.language}"
      lang="${bookJson.language}"
      xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<title>${htmlEncode(bookJson.title)}</title>
<link rel="stylesheet" type="text/css" href="${path}override_v1.css"/>
${cssHrefs.join("")}
</head>
<body>
<div id="book-content">
${fileText}
</div>
</body>
</html>`;

            epubFileList[i].contents = fflate.strToU8(xhtmlTemplate);
          }
        }

        // Get the content file
        const contentFile = filesJson.results.find(
          (file) => file.media_type === "application/oebps-package+xml"
        );

        const containerFile = {
          filename: "META-INF/container.xml",
          mediaType: "text/xml",
          simpleType: "text",
          contents: fflate.strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${contentFile.full_path}" media-type="${contentFile.media_type}"/>
  </rootfiles>
</container>`),
        };
        epubFileList.push(containerFile);

        const ibooksDisplayFile = {
          filename: "META-INF/com.apple.ibooks.display-options.xml",
          mediaType: "text/xml",
          simpleType: "text",
          contents: fflate.strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<display_options>
  <platform name="*">
    <option name="specified-fonts">true</option>
  </platform>
</display_options>`),
        };
        epubFileList.push(ibooksDisplayFile);

        // Fix up toc (which sometimes doesn't exist?)
        let parser = new DOMParser();
        let toc = epubFileList.find(
          (x) => x.mediaType === "application/x-dtbncx+xml"
        );
        let xmlDoc;
        if (toc) {
          xmlDoc = parser.parseFromString(
            fflate.strFromU8(toc.contents),
            "text/xml"
          );

          const tocXML = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            new XMLSerializer().serializeToString(xmlDoc.documentElement),
          ].join("");
          epubFileList.find(
            (x) => x.mediaType === "application/x-dtbncx+xml"
          ).contents = fflate.strToU8(tocXML);
        }

        // Watermark
        if (!message.byPass) {
          parser = new DOMParser();
          xmlDoc = parser.parseFromString(
            fflate.strFromU8(
              epubFileList.find((x) => x.filename === contentFile.full_path)
                .contents
            ),
            "text/xml"
          );
          let titleNode = xmlDoc.getElementsByTagNameNS(
            "http://purl.org/dc/elements/1.1/",
            "title"
          )[0];
          titleNode.textContent = `${titleNode.textContent} (for ${message.user.first_name} ${message.user.last_name})`;

          const stringXML = [
            `<?xml version="1.0" encoding="UTF-8"?>`,
            new XMLSerializer().serializeToString(xmlDoc.documentElement),
          ].join("");
          epubFileList.find(
            (x) => x.filename === contentFile.full_path
          ).contents = fflate.strToU8(stringXML);
        }

        const toZip = {};

        await Promise.all(
          epubFileList.map(async (file, index) => {
            let level = index === 0 ? 0 : 9;
            toZip[file.filename] = [file.contents, { level }];
          })
        );
        console.log(`background.js creating ePub book and downloading`);
        chrome.tabs.sendMessage(tabId, {
          action: "updateEpubMessage",
          text: "Creating ePub book and downloading",
        });
        const res = fflate.zipSync(toZip, { level: 0 });

        //self implemented pdf conversion starts here

        const blobEpub = new Blob([res], { type: "application/epub+zip" });
        let Base64EpubData = ""

        console.log(`structure of blobEpub: ${JSON.stringify(blobEpub)}`);
        const reader = new FileReader();
        reader.readAsDataURL(blobEpub);
        reader.onloadend = function () {
          const base64String = reader.result;
          console.log('Base64 String - ', base64String);
          Base64EpubData = base64String.substr(base64String.indexOf(', ') + 1);
        }

        const b64toBlob = (b64Data, contentType = '', sliceSize = 512) => {
          const byteCharacters = atob(b64Data);
          const byteArrays = [];

          for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);

            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
              byteNumbers[i] = slice.charCodeAt(i);
            }

            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
          }

          const blob = new Blob(byteArrays, { type: contentType });
          return blob;
        }

        const conversionRequestOptions = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            "Parameters": [
              {
                "Name": "File",
                "FileValue": {
                  "Name": `${bookJson.identifier}.epub`,
                  "Data": `${Base64EpubData}`
                }
              },
              {
                "Name": "FileName",
                "Value": `${bookJson.identifier}`
              },
            ]
          },
        };

        let convertApi = ConvertApi.auth(`${configData.secret}`)
        let params = convertApi.createParams()
        params.add('File', elFileInput.files[0]);
        params.add('FileName', `${bookJson.identifier}`);
        let result = await convertApi.convert('epub', 'pdf', params)

        const body = response.body;
        const pdfFileDataRaw = body.Files[0].FileData;
        const pdfFileBase64 = pdfFileDataRaw.substr(pdfFileDataRaw.indexOf(', ') + 1);
        const pdfFileBlob = b64toBlob(pdfFileDataRaw, "application/pdf");


        console.log(`convert to pdf finished`);
        const pdfToDownload = URL.createObjectURL(
          pdfFileBlob
        );
        console.log(`beginning download pdf file ${bookJson.identifier}`);
        await chrome.downloads.download(
          {
            url: pdfToDownload,
            filename: `${bookJson.identifier}.pdf`,
            saveAs: false,
          },
          async (downloadId) => {
            console.log(`begin of download pdf file callback method ${bookJson.identifier}`);
            epubFileList.length = 0;

            // Free up the blob object (not immediately, as Firefox breaks)
            setTimeout(() => {
              URL.revokeObjectURL(blobtodownload);
            }, 2000);

            sendResponse({ completed: true });
            console.log(`end of download pdf file callback method ${bookJson.identifier}`);
            return true;
          }
        );
        // console.log(`beginning download epub file ${bookJson.identifier}`);
        //const blobtodownload = URL.createObjectURL(
        //  blobEpub
        //);
        // await chrome.downloads.download(
        //   {
        //     url: blobtodownload,
        //     filename: `${bookJson.identifier}.epub`,
        //     saveAs: false,
        //   },
        //   async (downloadId) => {
        //     console.log(`begin of download epub file callback method ${bookJson.identifier}`);
        //     epubFileList.length = 0;

        //     // Free up the blob object (not immediately, as Firefox breaks)
        //     setTimeout(() => {
        //       URL.revokeObjectURL(blobtodownload);
        //     }, 2000);

        //     sendResponse({ completed: true });
        //     console.log(`end of download epub file callback method ${bookJson.identifier}`);
        //     return true;
        //   }
        // );
        console.log(`ending of epub file download ${bookJson.identifier}`);
        chrome.tabs.sendMessage(tabId, {
          action: "updateEpubMessage",
          text: "ePub download complete!",
        });
        return true;
      }
      if (message.action === "downloadCaptionSrt") {
        courseTitle = message.courseTitle;
        folderName = message.parentTitle;

        let filename = message.filename;
        if (message.index) {
          filename = message.index + filename;
        }
        if (courseTitle) {
          courseTitle = courseTitle.trim();
          if (folderName) {
            const folder = `${folderName.trim()}/`;
            filename = `${courseTitle}/${folder}${filename.replaceAll(
              "_",
              " "
            )}`;
          } else {
            filename = `${courseTitle}/${filename.replaceAll("_", " ")}`;
          }
          courseTitle = null;
          folderName = null;
        } else {
          filename = filename.replaceAll("_", " ");
        }

        chrome.downloads.download(
          {
            url: message.url,
            filename,
            saveAs: false,
          },
          function (downloadId) {
            type = "caption";
            sendResponse({
              completed: true,
              downloadId,
            });
          }
        );
        return true;
      }
      if (message.action === "downloadVideo") {
        courseTitle = message.courseTitle;
        folderName = message.parentTitle;

        let filename = message.filename;
        if (message.index) {
          filename = message.index + filename;
        }
        if (courseTitle) {
          courseTitle = courseTitle.trim();
          if (folderName) {
            const folder = `${folderName.trim()}/`;
            filename = `${courseTitle}/${folder}${filename.replaceAll(
              "_",
              " "
            )}`;
          } else {
            filename = `${courseTitle}/${filename.replaceAll("_", " ")}`;
          }
          courseTitle = null;
          folderName = null;
        } else {
          filename = filename.replaceAll("_", " ");
        }

        chrome.downloads.download(
          {
            url: message.url,
            filename,
            saveAs: false,
          },
          function (downloadId) {
            type = "video";
            sendResponse({
              completed: true,
              downloadId,
            });
          }
        );
        return true;
      }
      if (message.action === "downloadRecordedSession") {
        chrome.downloads.download({
          url: message.url,
        });
      }
      if (message.action === "downloadCaptionVtt") {
        chrome.downloads.download({
          url: message.url,
        });
      }
      if (message.action === "backgroundDownload") {
        const currentTime = new Date().getTime();
        if (currentTime - message.session.timestamp >= TWENTY_MINUTES) {
          // session is about to expire, renew
          message.session = await mod.getSession();
        }
        for (const item of message.queue) {
          if (message.type === "video") {
            let url = await mod.getVideoDownloadUrl(
              message.session.session,
              item.flavorId
            );
            const fileNameMatcher = /(?:fileName\/)(?<filename>.*)(?:\/name)/;
            const origFileName = url.match(fileNameMatcher).groups.filename;
            let newFileName = `${replaceInvalidFileNameCharacters(
              item.title
            ).replaceAll(/ /g, "_")}.${item.fileExt}`;
            url = url.replace(
              `fileName/${origFileName}`,
              `fileName/${newFileName}`
            );
            let index = item.index
              ? `${padZeroes(item.index, 3)}. `
              : undefined;

            // courseTitle = message.courseTitle;
            // folderName = message.parentTitle;

            // let filename = message.filename;
            if (index) {
              newFileName = index + newFileName;
            }
            let filename;
            if (item.courseTitle) {
              item.courseTitle = item.courseTitle.trim();
              if (item.parentTitle) {
                const folder = `${item.parentTitle.trim()}/`;
                filename = `${item.courseTitle
                  }/${folder}${newFileName.replaceAll("_", " ")}`;
              } else {
                filename = `${item.courseTitle}/${newFileName.replaceAll(
                  "_",
                  " "
                )}`;
              }
            } else {
              filename = newFileName.replaceAll("_", " ");
            }

            chrome.downloads.download(
              {
                url,
                filename,
                saveAs: false,
              },
              function (downloadId) {
                type = "video";
                sendResponse({
                  completed: true,
                  downloadId,
                });
              }
            );
            return true;
          }
        }
      }
    }
  );
})();

