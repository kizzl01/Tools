"use strict";
console.log("contentscript start before var decl");
const TWENTY_MINUTES = 20 * 60 * 1000;
const streamOptionsId = "stream-options";
let downloadAllAssetsId;
let downloadAllCaptionsId;
const videoLinksId = "video-links";
const toastId = "myoreillytoast";
const modId = "mod_id";
const toastErrorContainerId = "toast-error-container";
const dataForAssetsUrls = [];
const dataForCaptionsUrls = [];
let session;

const toastErrorContainer = createPopulatedElement(
  "div",
  null,
  "centerMe"
);
toastErrorContainer.id = toastErrorContainerId;
document.body.appendChild(toastErrorContainer);
const toast = createPopulatedElement("div", null, "toast");
toast.id = toastId;
toastErrorContainer.appendChild(toast);
console.log("contentscript start after var decl");

function getUserStatus(userJSON) {
  const status = {
    reason: "",
    canProceed: true,
  };

  // Trial has expired and no active subscription
  if (userJSON.expired_trial && !userJSON.subscription.active) {
    const trialExpirationDate = new Date(userJSON.trial.trial_expiration_date);
    status.canProceed = false;
    status.reason = `Your O'Reilly Learning trial expired on ${formatDate(
      trialExpirationDate
    )}, you cannot download anything with an expired trial account.`;
    return status;
  }

  // Subscription is inactive and cancellation date is in the past
  if (
    !userJSON.subscription.active &&
    userJSON.subscription.cancellation_date !== null
  ) {
    const cancellationDate = new Date(userJSON.subscription.cancellation_date);
    // If the cancellation date is past
    if (cancellationDate < new Date()) {
      status.canProceed = false;
      status.reason = `Your O'Reilly Learning subscription was cancelled on ${formatDate(
        cancellationDate
      )}, you cannot download anything with an inactive subscription.`;
      return status;
    }
  }

  return status;
}

function test_getUserStatusWithExpiredTrial(userJSON) {
  userJSON.expired_trial = true;
  userJSON.trial.trial_expiration_date = "2021-08-27T15:17:31.030560Z";
  userJSON.subscription.active = false;
  // userJSON.subscription.cancellation_date = "2022-09-14";
  return getUserStatus(userJSON);
}

function test_getUserStatusWithCancelledSub(userJSON) {
  userJSON.expired_trial = false;
  userJSON.trial.trial_expiration_date = "2021-08-27T15:17:31.030560Z";
  userJSON.subscription.active = false;
  userJSON.subscription.cancellation_date = "2022-09-14";
  return getUserStatus(userJSON);
}

function makeStreamOptionsDiv() {
  removeElement(streamOptionsId);
  const streamOptionsDiv = createPopulatedElement("div", null, "loader");
  streamOptionsDiv.id = streamOptionsId;
  return streamOptionsDiv;
}

function removeElement(id) {
  const existingElement = document.getElementById(id);
  if (existingElement) {
    existingElement.parentElement.removeChild(existingElement);
  }
}

function getVideoWindow() {
  // Looks for new layout
  let videoWindow = document.querySelector("[class^=sandboxFrame]");
  if (!videoWindow) {
    // Looks for old layout
    videoWindow = document.querySelector(".content-VideoPlayer-playerWrapper");
  }
  return videoWindow;
}

function insertElementBelowVideoWindow(elementToInsert) {
  const videoWindow = getVideoWindow();
  // Looks for new layout
  if (videoWindow) {
    if (videoWindow.className.indexOf("sandbox") >= 0) {
      const parentElement = videoWindow.parentElement;
      const detailsElement = parentElement.querySelector("[class^=details--]");
      if (detailsElement) {
        parentElement.insertBefore(elementToInsert, detailsElement);
      } else {
        parentElement.appendChild(elementToInsert);
      }
    } else {
      // Looks for old layout
      videoWindow.appendChild(elementToInsert);
    }
  }
}

function addFileToList(filename, filesize, downloadId, resolution) {
  chrome.storage.local.get("downloads", function (result) {
    if (!result["downloads"]) result.downloads = {};
    if (!result.downloads.files) {
      result.downloads.files = [];
    }
    result.downloads.files.push({
      filename,
      filesize,
      timestamp: new Date().getTime(),
      downloadId,
      resolution,
    });
    chrome.storage.local.set({
      downloads: result.downloads,
    });
  });
}

function getInitialStoreDataFromDocument() {
  const scriptText = Array.from(document.getElementsByTagName("script")).find(
    (script) => script.innerText.indexOf("initialStoreData = ") > 0
  ).innerText;
  const dataMatcher =
    /(?:window.initialStoreData = )(?<json>[\p{P}\p{L}\p{N}\p{M}\p{S}\p{Z}\p{C}]*)(?:;)/u;
  return JSON.parse(scriptText.match(dataMatcher).groups.json);
}

function filterFlavorResults(flavorResults, mediaId) {
  let videoFlavors = flavorResults.filter(
    (flavor) => flavor.entryId === mediaId && flavor.videoCodecId
  );
  videoFlavors.sort((a, b) =>
    a.bitrate > b.bitrate ? 1 : a.bitrate < b.bitrate ? -1 : 0
  );
  videoFlavors.sort((a, b) =>
    a.height < b.height ? 1 : a.height > b.height ? -1 : 0
  );
  videoFlavors = videoFlavors.filter((ac, i, arr) => {
    if (i === 0) return true;
    return ac.height !== arr[i - 1].height;
  });

  let audioFlavors = flavorResults.filter(
    (flavor) => flavor.entryId === mediaId && !flavor.videoCodecId
  );
  audioFlavors.sort((a, b) =>
    a.bitrate < b.bitrate ? 1 : a.bitrate > b.bitrate ? -1 : 0
  );

  videoFlavors.push(...audioFlavors);
  return videoFlavors;
}

function getPathLastPart(path) {
  const parts = path.split("/").filter((p) => p);
  return parts[parts.length - 1];
}

async function getVideoAndCaptionDataForVideoWindow(storeData, contentId) {
  const videoKey = Object.keys(storeData.appState.tableOfContents)[0];
  const currentItem = storeData.appState.tableOfContents[
    videoKey
  ].sections.find((section) => section.contentId === contentId);

  if (!currentItem) return;

  try {
    session = await mod.getSession();
    const config = await mod.getConfig();
    const mediaResult = await mod.getMediaIds(
      session.session,
      config.partner_id,
      [currentItem.contentId],
      1
    );
    let flavorResults = await mod.getFlavorIds(
      session.session,
      config.partner_id,
      [mediaResult.objects[0].id],
      1
    );
    flavorResults = filterFlavorResults(
      flavorResults.objects,
      mediaResult.objects[0].id
    );

    const captionResults = await mod.getCaptionIds(
      session.session,
      [mediaResult.objects[0].id],
      1
    );

    return {
      flavorResults,
      captionResults: captionResults.objects,
      currentItem,
    };
  } catch (e) {
    return { error: e.message };
  }
}

function pushDownloadedFileToPopupList(
  downloadId,
  filename,
  filesize,
  resolution
) {
  chrome.storage.local.get("downloads", (result) => {
    const files = [];
    if (result.downloads) {
      files.push(...result.downloads.files);
    } else {
      result.downloads = {};
    }
    const timestamp = new Date().getTime();
    const fileObj = {
      downloadId,
      filename,
      filesize,
      timestamp,
    };
    if (resolution) fileObj.resolution = resolution;
    files.push(fileObj);
    result.downloads.files = files;
    chrome.storage.local.set({ downloads: result.downloads });
  });
}

function getMediaDownloadButton(text, event, data) {
  const button = createPopulatedElement(
    "div",
    text,
    "resBlock margin-right-10 tooltip fade-in",
    "click",
    event
  );
  if (data) Object.assign(button.dataset, data);
  return button;
}

function makeMediaButtons(flavor, item) {
  let buttonText;
  let toolTip;
  let res;

  if (flavor.videoCodecId) {
    buttonText = `${flavor.height}p`;
    res = flavor.height;
    toolTip = createPopulatedElement(
      "div",
      `${flavor.fileExt.toUpperCase()} file (${formatFileSize(
        flavor.sizeInBytes
      )})`,
      "tooltiptext tooltiptextMP4Batch"
    );
  } else {
    buttonText = "Audio";
    res = flavor.bitrate;
    toolTip = createPopulatedElement(
      "div",
      `${flavor.bitrate}kbps ${flavor.fileExt.toUpperCase()} (${formatFileSize(
        flavor.sizeInBytes
      )})`,
      "tooltiptext tooltiptextMP4Batch"
    );
  }
  const extraData = {
    flavorId: flavor.id,
    title: item.title,
    fileExt: flavor.fileExt,
    fileSize: flavor.sizeInBytes,
    resolution: res,
    courseTitle: replaceInvalidFileNameCharacters(item.courseTitle),
  };
  if (item.parentTitle)
    extraData.parentTitle = replaceInvalidFileNameCharacters(item.parentTitle);

  const buttonBlock = getMediaDownloadButton(
    buttonText,
    async (e) => {
      session = await mod.getSession();
      dataForAssetsUrls.push({
        flavorId: flavor.id,
        title: item.title,
        fileExt: flavor.fileExt,
        fileSize: flavor.sizeInBytes,
        resolution: res,
      });
      downloadVideoAudio(session, dataForAssetsUrls[0]);
    },
    extraData
  );
  buttonBlock.appendChild(toolTip);
  return buttonBlock;
}

function populateVideoWindowDownloads(allResults) {
  const streamOptionsDiv = makeStreamOptionsDiv();
  const videoLabel = createPopulatedElement(
    "div",
    "Formats: ",
    "downloadLabel fade-in"
  );
  streamOptionsDiv.appendChild(videoLabel);

  for (const flavor of allResults.flavorResults) {
    const buttonBlock = makeMediaButtons(flavor, allResults.currentItem);
    streamOptionsDiv.append(buttonBlock);
  }

  if (allResults.captionResults && allResults.captionResults.length > 0) {
    const spacer = createPopulatedElement("div", null, "spacer");
    streamOptionsDiv.appendChild(spacer);
    const captionLabel = createPopulatedElement(
      "div",
      "Captions: ",
      "downloadLabel fade-in"
    );
    streamOptionsDiv.appendChild(captionLabel);

    for (const caption of allResults.captionResults) {
      const captionBlock = getCaptionDownloadButton(
        caption.label ? caption.label : caption.language,
        async (e) => {
          session = await mod.getSession();

          dataForCaptionsUrls.push({
            captionId: caption.id,
            title: allResults.currentItem.title,
            languageCode: caption.languageCode,
            fileExt: caption.fileExt,
          });

          downloadCaptions(session, dataForCaptionsUrls[0]);
        }
      );
      streamOptionsDiv.appendChild(captionBlock);
    }
  }

  insertElementBelowVideoWindow(streamOptionsDiv);
}

async function getVideoWindowData(userStatus) {
  const storeData = getInitialStoreDataFromDocument();

  let contentId = getPathLastPart(document.location.pathname);
  let videoWindowData = await getVideoAndCaptionDataForVideoWindow(
    storeData,
    contentId
  );

  // I hate this, but it provides enough of a delay to work.
  // Too lazy to implement yet another mutation observer.
  if (!userStatus.canProceed) {
    const streamOptionsDiv = makeStreamOptionsDiv();
    const errorMessage = createPopulatedElement(
      "div",
      `ERROR: ${userStatus.reason}`,
      "errorLabel errorLabelLarge"
    );
    streamOptionsDiv.appendChild(errorMessage);
    insertElementBelowVideoWindow(streamOptionsDiv);
    return;
  }

  if (videoWindowData && !videoWindowData.error) {
    populateVideoWindowDownloads(videoWindowData);
    const streamOptionsDiv = document.getElementById(streamOptionsId);

    if (streamOptionsDiv) {
      // Scroll so the downloading options are visible
      const shellContent = document.getElementsByClassName(
        "orm-ff-Shell-content"
      );
      if (shellContent.length > 0) {
        shellContent[0].scrollTo({
          top: streamOptionsDiv.parentElement.parentElement.offsetTop - 40,
          behavior: "smooth",
        });
      }
    }
  } else if (videoWindowData && videoWindowData.error) {
    const streamOptionsDiv = makeStreamOptionsDiv();
    const errorMessage = createPopulatedElement(
      "div",
      `ERROR: ${videoWindowData.error}`,
      "errorLabel"
    );
    streamOptionsDiv.appendChild(errorMessage);
    insertElementBelowVideoWindow(streamOptionsDiv);
  }
}

const downloadCaptions = async (session, captionData) => {
  const currentTime = new Date().getTime();
  if (currentTime - session.timestamp >= TWENTY_MINUTES) {
    // session is about to expire, renew
    session = await mod.getSession();
  }
  let url = await mod.getCaptionDownloadUrl(
    session.session,
    captionData.captionId
  );
  if (typeof url === "string") {
    const filename = `${replaceInvalidFileNameCharacters(
      captionData.title
    ).replaceAll(/ /g, "_")}_${captionData.languageCode}.${
      captionData.fileExt ? captionData.fileExt : "srt"
    }`;

    let index = captionData.index
      ? `${padZeroes(captionData.index, 3)}. `
      : undefined;

    toast.innerText = `Downloading "${captionData.title}.${captionData.fileExt}"...`;
    toast.classList.toggle("show");
    setTimeout(() => toast.classList.toggle("show"), 2750);

    chrome.runtime.sendMessage({
      action: "downloadCaptionSrt",
      filename: filename,
      parentTitle: captionData.parentTitle,
      courseTitle: captionData.courseTitle,
      url: `${url}/filename/${filename}`,
      index,
    });
  } else {
    chrome.runtime.sendMessage({
      action: "sendBadDownloadUrlMessage",
      filename: captionData.title,
    });
  }
};

const sendQueueToBackground = (session, queue, type) => {
  chrome.runtime.sendMessage({
    action: "backgroundDownload",
    session,
    queue,
    type,
  });
};

const downloadVideoAudio = async (session, videoData) => {
  const currentTime = new Date().getTime();
  if (currentTime - session.timestamp >= TWENTY_MINUTES) {
    // session is about to expire, renew
    session = await mod.getSession();
  }
  let url = await mod.getVideoDownloadUrl(session.session, videoData.flavorId);
  const fileNameMatcher = /(?:fileName\/)(?<filename>.*)(?:\/name)/;
  const origFileName = url.match(fileNameMatcher).groups.filename;
  const newFileName = `${replaceInvalidFileNameCharacters(
    videoData.title
  ).replaceAll(/ /g, "_")}.${videoData.fileExt}`;
  url = url.replace(`fileName/${origFileName}`, `fileName/${newFileName}`);
  let index = videoData.index
    ? `${padZeroes(videoData.index, 3)}. `
    : undefined;

  toast.innerText = `Downloading "${videoData.title}.${videoData.fileExt}"...`;
  toast.classList.toggle("show");
  setTimeout(() => toast.classList.toggle("show"), 2750);

  chrome.runtime.sendMessage({
    action: "downloadVideo",
    filename: newFileName,
    parentTitle: videoData.parentTitle,
    courseTitle: videoData.courseTitle,
    url,
    index,
  });
};

function getCaptionDownloadButton(text, event, data) {
  const button = createPopulatedElement(
    "div",
    text,
    "captionBlock margin-right-10 fade-in",
    "click",
    event
  );
  if (data) Object.assign(button.dataset, data);
  return button;
}

const getPagedResults = async (messageElem, messageText, func, args) => {
  const results = [];
  let tempResults = await func.apply(null, args);

  if (tempResults.objects.length > 0) {
    results.push(...tempResults.objects);
    let pages = Math.ceil(tempResults.totalCount / tempResults.objects.length);

    if (pages > 1) {
      for (let pageCount = 2; pageCount <= pages; pageCount++) {
        messageElem.innerText = `${messageText} (page ${pageCount} of ${pages})...`;
        args[args.length - 1] = args[args.length - 1] + 1;
        tempResults = await func.apply(null, args);
        results.push(...tempResults.objects);
      }
    }
  }

  return results;
};

// NOTE: This is where it all begins
(async () => {
  console.log("contentscript async function call");
  let oldHref = document.location.href;
  const oReillyLogo = createPopulatedElement(
    "div",
    null,
    "myoreillylogo-img logopos"
  );
  oReillyLogo.id = modId;

  // on24.com stuff start
  if (
    document.location.pathname.indexOf(
      "/eventRegistration/console/apollox/mainEvent"
    ) >= 0
  ) {
    const bodyList = document.querySelector("body");
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(async (mutation) => {
        if (!document.getElementById(modId)) {
          const playerImageDiv = document.querySelector(
            '#main-console-container > div[data-testid="widget-window-player_image"]'
          );
          if (playerImageDiv) {
            oReillyLogo.classList.toggle("logopos");
            oReillyLogo.style.display = "flex";
            oReillyLogo.style.paddingLeft = "40px";
            oReillyLogo.style.top = "115px";
            oReillyLogo.style.left = "10px";
            oReillyLogo.style.position = "absolute";
            oReillyLogo.style.zIndex = "9999";
            playerImageDiv.appendChild(oReillyLogo);

            const urlParams = new URL(document.location).searchParams;
            const eventId = urlParams.get("eventid");
            const key = urlParams.get("key");
            const userId = urlParams.get("eventuserid");

            const videoRequest = await fetch(
              `https://event.on24.com/apic/utilApp/EventConsoleCachedServlet?eventId=${eventId}&eventSessionId=1&eventuserid=${userId}&displayProfile=player&key=${key}&contentType=A&useCache=true`
            );
            const videoResponse = await videoRequest.json();

            const videoDownloadButton = getMediaDownloadButton(
              "Video",
              async (e) => {
                const videoSection = videoResponse.mediaUrlInfo.find(
                  (x) => x.codecategory === "fhvideo1"
                );
                const videoUrlPath = videoSection.url;

                const downloadUrl = `https://on24static.akamaized.net/media/news/corporatevideo/events/${videoUrlPath}`;

                chrome.runtime.sendMessage({
                  action: "downloadRecordedSession",
                  url: downloadUrl,
                });
              }
            );
            videoDownloadButton.style.height = "22px";
            oReillyLogo.appendChild(videoDownloadButton);

            videoResponse.vttInfo.forEach((vtt) => {
              const captionButton = getCaptionDownloadButton(
                vtt.language,
                async (e) => {
                  chrome.runtime.sendMessage({
                    action: "downloadCaptionVtt",
                    url: vtt.uploadurl,
                  });
                }
              );
              captionButton.style.height = "22px";
              oReillyLogo.appendChild(captionButton);
            });
          }
        }
      });
    });

    const observerConfig = {
      childList: true,
      subtree: true,
    };

    observer.observe(bodyList, observerConfig);
    return;
  }
  // on24.com stuff end

  // Not finding the minimum we need, so exit
  const sidebar = document.querySelector("[data-testid^='sidebar']");
  if (!sidebar) return;

  sidebar.appendChild(oReillyLogo);

  const storeData = getInitialStoreDataFromDocument();
  const userStatus = getUserStatus(storeData.user);

  if (document.location.pathname.indexOf("library/view") > 0) {
    oReillyLogo.title = "Get ebook";

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "updateEpubMessage") {
        const logo = document.getElementById(modId);
        if (logo) {
          logo.innerText = message.text;
        }
      }
    });

    oReillyLogo.addEventListener("click", async (e) => {
      e.target.style.pointerEvents = "none";

      oReillyLogo.classList.add("wrapper");

      if (!userStatus.canProceed) {
        oReillyLogo.innerText = userStatus.reason;
        oReillyLogo.style.height = "initial";
        oReillyLogo.style.maxHeight = "105px";
        oReillyLogo.style.backgroundSize = "28px";
        return true;
      }

      await chrome.runtime.sendMessage({
        action: "startDownloadingEpub",
        origin: window.location.origin,
        tableOfContents: storeData.appState.tableOfContents,
        user: storeData.user,
        byPass: e.shiftKey && e.altKey,
      });
      return true;
    });
  } else {
    await getVideoWindowData(userStatus);

    const bodyList = document.querySelector("body");
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(async (mutation) => {
        if (oldHref != document.location.href) {
          oldHref = document.location.href;
          /* Changed ! your code here */

          await getVideoWindowData(userStatus);
          document
            .querySelector("[data-testid^='sidebar']")
            .appendChild(oReillyLogo);
        }
      });
    });

    const observerConfig = {
      childList: true,
      subtree: true,
    };

    observer.observe(bodyList, observerConfig);

    const fixedDiv = createPopulatedElement("div", null, "hidden");
    fixedDiv.id = videoLinksId;
    document.body.appendChild(fixedDiv);

    oReillyLogo.title = "Get course assets";
    oReillyLogo.addEventListener("click", async (e) => {
      if (!userStatus.canProceed) {
        e.target.style.pointerEvents = "none";
        oReillyLogo.classList.add("wrapper");
        oReillyLogo.innerText = userStatus.reason;
        oReillyLogo.style.height = "initial";
        oReillyLogo.style.maxHeight = "105px";
        oReillyLogo.style.backgroundSize = "28px";
        return;
      }

      try {
        if (!Array.from(fixedDiv.classList).includes("hidden")) {
          while (fixedDiv.hasChildNodes()) {
            fixedDiv.removeChild(fixedDiv.firstChild);
          }
          fixedDiv.classList.toggle("hidden");
          return;
        }

        session = await mod.getSession();
        fixedDiv.classList.add("wrapper-videos");
        fixedDiv.classList.toggle("hidden");

        const messageDiv = createPopulatedElement(
          "div",
          "Getting list of videos. Please wait...",
          "message"
        );
        fixedDiv.appendChild(messageDiv);

        const videoKey = Object.keys(storeData.appState.tableOfContents)[0];
        const courseTitle = storeData.appState.titles[videoKey].title;
        const sections = storeData.appState.tableOfContents[videoKey].sections;
        const videoClips = sections
          .filter((section) => section.contentFormat === "VideoClip")
          .map((section) => {
            return {
              courseTitle,
              title: section.title,
              contentId: section.contentId,
              parentId: section.parentId,
            };
          });
        videoClips.forEach((videoClip) => {
          const parent = sections.find(
            (section) => section.contentId === videoClip.parentId
          );
          if (parent) {
            videoClip.parentTitle = parent.title;
          }
        });

        let mediaResults = [];
        chrome.storage.local.get(videoKey, async (result) => {
          if (result && result[videoKey]) {
            mediaResults.push(...result[videoKey]);
          } else {
            const configData = await mod.getConfig();

            const referenceIds = videoClips.map((x) => x.contentId);
            messageDiv.innerText = "Getting list of media...";

            mediaResults = await getPagedResults(
              messageDiv,
              "Getting list of media",
              mod.getMediaIds,
              [session.session, configData.partner_id, referenceIds, 1]
            );

            // --- We now have all the video EntryIds --- //

            messageDiv.innerText =
              "Getting list of media formats (please be patient)...";

            let flavorResults = [];
            let captionResults = [];
            let i,
              j,
              temporary,
              chunk = 500;
            for (i = 0, j = mediaResults.length; i < j; i += chunk) {
              temporary = mediaResults.slice(i, i + chunk);

              flavorResults.push(
                ...(await getPagedResults(
                  messageDiv,
                  "Getting list of media formats",
                  mod.getFlavorIds,
                  [
                    session.session,
                    configData.partner_id,
                    temporary.map((media) => media.id),
                    1,
                  ]
                ))
              );

              // -- We now have all the flavors for each video EntryId -- //

              messageDiv.innerText =
                "Getting list of captions (please be patient)...";

              captionResults.push(
                ...(await getPagedResults(
                  messageDiv,
                  "Getting list of captions",
                  mod.getCaptionIds,
                  [session.session, temporary.map((media) => media.id), 1]
                ))
              );

              // -- We now have all the captions for each video EntryId -- //
            }

            for (const mediaResult of mediaResults) {
              const flavors = filterFlavorResults(
                flavorResults,
                mediaResult.id
              );
              const captions = captionResults.filter(
                (caption) => caption.entryId === mediaResult.id
              );
              mediaResult.flavors = flavors;
              mediaResult.captions = captions;
            }

            const toStore = {};
            toStore[videoKey] = mediaResults;
            chrome.storage.local.set(toStore);
          }

          const closeMe = createPopulatedElement(
            "div",
            null,
            "closeMe orm-Icon-icon orm-icon-close-x",
            "click",
            async (e) => {
              while (fixedDiv.hasChildNodes()) {
                fixedDiv.removeChild(fixedDiv.firstChild);
              }
              fixedDiv.classList.toggle("hidden");
            }
          );
          fixedDiv.insertBefore(closeMe, messageDiv);

          messageDiv.innerText = "Assets";
          messageDiv.className = "videosHeading";

          const bulkDownloaderContainerDiv = createPopulatedElement(
            "div",
            null,
            "flex-container"
          );
          fixedDiv.appendChild(bulkDownloaderContainerDiv);

          for (const clip of videoClips) {
            const fileName = createPopulatedElement(
              "div",
              clip.title,
              "filename"
            );
            fixedDiv.appendChild(fileName);

            const fileDownloadDiv = createPopulatedElement(
              "div",
              null,
              "flex-container"
            );
            fileDownloadDiv.dataset.type = "videos";
            fixedDiv.appendChild(fileDownloadDiv);

            const mediaResultForClip = mediaResults.find(
              (media) => media.referenceId === clip.contentId
            );

            if (mediaResultForClip) {
              for (const flavor of mediaResultForClip.flavors) {
                const buttonBlock = makeMediaButtons(flavor, clip);
                fileDownloadDiv.appendChild(buttonBlock);
              }

              if (
                mediaResultForClip.captions &&
                mediaResultForClip.captions.length > 0
              ) {
                const captionDownloadDiv = createPopulatedElement(
                  "div",
                  null,
                  "flex-container"
                );
                captionDownloadDiv.style.paddingTop = "5px";
                fixedDiv.appendChild(captionDownloadDiv);

                for (const caption of mediaResultForClip.captions) {
                  const captionBlock = getCaptionDownloadButton(
                    caption.label ? caption.label : caption.language,
                    async (e) => {
                      dataForCaptionsUrls.push({
                        captionId: caption.id,
                        title: clip.title,
                        languageCode: caption.languageCode,
                        fileExt: caption.fileExt,
                      });

                      downloadCaptions(session, dataForCaptionsUrls[0]);
                    },
                    {
                      id: caption.id,
                      title: clip.title,
                      fileExt: caption.fileExt ? caption.fileExt : "srt",
                      parentTitle: clip.parentTitle
                        ? replaceInvalidFileNameCharacters(clip.parentTitle)
                        : undefined,
                      courseTitle: replaceInvalidFileNameCharacters(
                        clip.courseTitle
                      ),
                      languageCode: caption.languageCode,
                    }
                  );
                  captionDownloadDiv.appendChild(captionBlock);
                }
              }
            }
          }

          const availableRes = [
            ...new Set(
              [].map.call(document.querySelectorAll(".resBlock"), (x) =>
                x.innerText === "Audio" ? 0 : parseInt(x.dataset.resolution)
              )
            ),
          ].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

          const downloadAllContainerDiv = createPopulatedElement(
            "div",
            "Download options",
            "captionBlock tooltip fade-in zIndex3 margin-right-10"
          );
          const availableResDiv = createPopulatedElement(
            "div",
            null,
            "flex-container flex-column margin-bottom-20 collapseVis margin-top-5"
          );
          downloadAllContainerDiv.appendChild(availableResDiv);

          const downloadAllAvailableHiRes = createPopulatedElement(
            "div",
            "High quality assets",
            "tooltiptext tooltiptextQuality",
            "click",
            async (e) => {
              e.target.id = downloadAllAssetsId = "allAvailableHiRes";
              e.target.style.pointerEvents = "none";
              e.target.innerText = "Downloading...";
              const allVideoContainers = document.querySelectorAll(
                "[data-type='videos']"
              );

              let fileCount = 0;
              for (const container of allVideoContainers) {
                if (
                  container.hasChildNodes() &&
                  container.firstChild.dataset.flavorId
                ) {
                  const flavorId = container.firstChild.dataset.flavorId;
                  const title = container.firstChild.dataset.title;
                  const fileExt = container.firstChild.dataset.fileExt;
                  const parentTitle = container.firstChild.dataset.parentTitle;
                  const courseTitle = container.firstChild.dataset.courseTitle;
                  const fileSize = container.firstChild.dataset.fileSize;
                  const resolution = container.firstChild.dataset.resolution;

                  if (
                    dataForAssetsUrls.length > 0 &&
                    parentTitle !==
                      dataForAssetsUrls[dataForAssetsUrls.length - 1]
                        .parentTitle
                  ) {
                    fileCount = 0;
                  }

                  dataForAssetsUrls.push({
                    flavorId,
                    title,
                    fileExt,
                    parentTitle,
                    courseTitle,
                    fileSize,
                    resolution,
                    index: ++fileCount,
                  });
                }
              }
              //await downloadVideoAudio(session, dataForAssetsUrls[0]);
              sendQueueToBackground(session, dataForAssetsUrls, "video");
            }
          );
          availableResDiv.appendChild(downloadAllAvailableHiRes);

          availableRes.forEach((res) => {
            const grouping =
              res > 0
                ? document.querySelectorAll(`[data-resolution="${res}"]`)
                    .length === videoClips.length
                  ? "All"
                  : "Some"
                : [].filter.call(
                    document.querySelectorAll(".resBlock"),
                    (block) => block.innerText === "Audio"
                  ).length >= videoClips.length
                ? "All"
                : "Some";

            const resDownloadAll = createPopulatedElement(
              "div",
              res > 0 ? `${grouping} ${res}p videos` : `${grouping} Audio`,
              "tooltiptext tooltiptextQuality",
              "click",
              async (e) => {
                downloadAllAssetsId = e.target.id;
                e.target.style.pointerEvents = "none";
                e.target.innerText = "Downloading...";
                const allResButtons =
                  res > 0
                    ? document.querySelectorAll(`[data-resolution="${res}"]`)
                    : [].filter.call(
                        document.querySelectorAll(".resBlock"),
                        (block) => {
                          // Audio books
                          if (
                            availableRes.length === 1 &&
                            block.dataset.fileExt === "mp3"
                          ) {
                            return block;
                          }
                          // Audio only from video
                          if (
                            availableRes.length > 1 &&
                            block.innerText === "Audio"
                          ) {
                            return block;
                          }
                        }
                      );

                let fileCount = 0;
                for (const resButton of allResButtons) {
                  if (
                    dataForAssetsUrls.length > 0 &&
                    resButton.dataset.parentTitle !==
                      dataForAssetsUrls[dataForAssetsUrls.length - 1]
                        .parentTitle
                  ) {
                    fileCount = 0;
                  }

                  dataForAssetsUrls.push({
                    flavorId: resButton.dataset.flavorId,
                    title: resButton.dataset.title,
                    fileExt: resButton.dataset.fileExt,
                    parentTitle: resButton.dataset.parentTitle,
                    courseTitle: resButton.dataset.courseTitle,
                    fileSize: resButton.dataset.fileSize,
                    resolution: resButton.dataset.resolution,
                    index: ++fileCount,
                  });
                }
                await downloadVideoAudio(session, dataForAssetsUrls[0]);
              }
            );
            resDownloadAll.id = `resAll${res}`;
            availableResDiv.appendChild(resDownloadAll);
          });

          fixedDiv.insertBefore(
            bulkDownloaderContainerDiv,
            fixedDiv.querySelector(".filename")
          );
          bulkDownloaderContainerDiv.appendChild(downloadAllContainerDiv);

          const availableCaptions = [
            ...new Set(
              [].map.call(
                document.querySelectorAll("[data-language-code]"),
                (x) => `${x.dataset.languageCode},${x.innerText}`
              )
            ),
          ];
          if (availableCaptions.length > 0) {
            const downloadAllCaptionsDiv = createPopulatedElement(
              "div",
              "Caption options",
              "captionBlock tooltip fade-in zIndex3"
            );
            bulkDownloaderContainerDiv.appendChild(downloadAllCaptionsDiv);
            const availableCaptionDiv = createPopulatedElement(
              "div",
              null,
              "flex-container flex-column margin-bottom-20 collapseVis margin-top-5"
            );
            downloadAllCaptionsDiv.appendChild(availableCaptionDiv);

            availableCaptions.forEach((cap) => {
              const parts = cap.split(",");
              const grouping =
                document.querySelectorAll(`[data-language-code="${parts[0]}"]`)
                  .length >= videoClips.length
                  ? "All"
                  : "Some";

              const captionDownloadAll = createPopulatedElement(
                "div",
                `${grouping} ${parts[1]}`,
                "tooltiptext tooltiptextQuality",
                "click",
                async (e) => {
                  downloadAllCaptionsId = e.target.id;
                  e.target.style.pointerEvents = "none";
                  e.target.innerText = "Downloading...";
                  const allCaptionButtons = document.querySelectorAll(
                    `[data-language-code="${parts[0]}"]`
                  );

                  let fileCount = 0;
                  for (const captionButton of allCaptionButtons) {
                    if (
                      dataForCaptionsUrls.length > 0 &&
                      captionButton.dataset.parentTitle !==
                        dataForCaptionsUrls[dataForCaptionsUrls.length - 1]
                          .parentTitle
                    ) {
                      fileCount = 0;
                    }

                    dataForCaptionsUrls.push({
                      captionId: captionButton.dataset.id,
                      title: captionButton.dataset.title,
                      fileExt: captionButton.dataset.fileExt,
                      parentTitle: captionButton.dataset.parentTitle,
                      courseTitle: captionButton.dataset.courseTitle,
                      languageCode: captionButton.dataset.languageCode,
                      index: ++fileCount,
                    });
                  }
                  await downloadCaptions(session, dataForCaptionsUrls[0]);
                }
              );
              captionDownloadAll.id = `captionAll${parts[0]}`;
              availableCaptionDiv.appendChild(captionDownloadAll);
            });
          }
        });
      } catch (e) {
        if (Array.from(fixedDiv.classList).includes("hidden")) {
          const errorMessage = createPopulatedElement(
            "div",
            `ERROR: ${e.message}`,
            "errorLabel errorLabelLarge"
          );
          fixedDiv.appendChild(errorMessage);
        }
        fixedDiv.classList.toggle("hidden");
      }
    });

    chrome.runtime.onMessage.addListener(
      async (message, sender, sendResponse) => {
        if (message.action === "notifyDownloadComplete") {
          let artefacts =
            message.type === "video" ? dataForAssetsUrls : dataForCaptionsUrls;
          let id =
            message.type === "video"
              ? downloadAllAssetsId
              : downloadAllCaptionsId;

          if (artefacts.length > 0) {
            if (message.state === "interrupted") {
              message.downloadId = -1;
              const failedDiv = createPopulatedElement(
                "div",
                `Failed to download ${artefacts[0].title.replaceAll(
                  "_",
                  " "
                )}.${artefacts[0].fileExt}`,
                "show failed"
              );
              toastErrorContainer.appendChild(failedDiv);
              setTimeout(() => {
                failedDiv.classList.remove("show");
                setTimeout(
                  () => toastErrorContainer.removeChild(failedDiv),
                  250
                );
              }, 4750);
              artefacts[0].title = `(FAILED) ${artefacts[0].title}`;
            }

            if (message.type === "video") {
              const timestamp = new Date().getTime();
              pushDownloadedFileToPopupList(
                message.downloadId,
                `${artefacts[0].title.replaceAll("_", " ")}.${
                  artefacts[0].fileExt
                }`,
                artefacts[0].fileSize,
                artefacts[0].resolution,
                timestamp
              );
            }

            artefacts.splice(0, 1);
            if (artefacts.length > 0) {
              if (message.type === "video") {
                await downloadVideoAudio(session, artefacts[0]);
              } else {
                await downloadCaptions(session, artefacts[0]);
              }
            } else {
              if (id) {
                const downloadAllDiv = document.getElementById(id);
                if (downloadAllDiv) {
                  downloadAllDiv.style.backgroundColor = "#00dd00";
                  downloadAllDiv.innerText = "Downloading complete";
                  downloadAllAssetsId = undefined;
                  downloadAllCaptionsId = undefined;
                }
              }
            }
          }
        }
      }
    );
  }
})();
