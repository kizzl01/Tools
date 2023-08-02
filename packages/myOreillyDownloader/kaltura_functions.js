"use strict";
(() => {
  const origin = window.location.origin;
  const filterToUrlMap = [
    {
      type: "KalturaMediaEntryFilter",
      url: "https://www.kaltura.com/api_v3/service/media/action/list",
    },
    {
      type: "KalturaFlavorAssetFilter",
      url: "https://www.kaltura.com/api_v3/service/flavorasset/action/list",
    },
    {
      type: "KalturaCaptionAssetFilter",
      url: "https://www.kaltura.com/api_v3/service/caption_captionasset/action/list",
    },
    {
      type: "VideoDownloadUrl",
      url: "https://www.kaltura.com/api_v3/service/flavorasset/action/getUrl",
    },
    {
      type: "CaptionDownloadUrl",
      url: "https://www.kaltura.com/api_v3/service/caption_captionasset/action/getUrl",
    },
  ];
  const getListedAssets = async (session, filter, pageIndex) => {
    const controller = new AbortController();
    const pager = {
      objectType: "KalturaFilterPager",
      pageSize: 500,
      pageIndex,
    };
    const url = filterToUrlMap.find(
      (_filter) => _filter.type === filter.objectType
    ).url;

    try {
      setTimeout(async () => controller.abort(), 5000);
      const jsonQuery = await fetch(url, {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ks: session,
          format: 1,
          filter,
          pager,
        }),
      });
      return await jsonQuery.json();
    } catch (e) {
      return await getListedAssets(session, filter, pageIndex);
    }
  };
  const getDownloadUrl = async (session, type, id) => {
    const url = filterToUrlMap.find((_filter) => _filter.type === type).url;
    const urlQuery = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ks: session,
        format: 1,
        id,
      }),
    });
    return await urlQuery.json();
  };
  const getMediaIds = async (session, partnerId, referenceIds, pageIndex) => {
    const filter = {
      objectType: "KalturaMediaEntryFilter",
      partnerIdEqual: partnerId,
      referenceIdIn: referenceIds.join(),
    };
    return await getListedAssets(session, filter, pageIndex);
  };
  const getFlavorIds = async (session, partnerId, entryIds, pageIndex) => {
    const filter = {
      objectType: "KalturaFlavorAssetFilter",
      partnerIdEqual: partnerId,
      entryIdIn: entryIds.join(),
      //flavorParamsIdIn: "0,487081,487061,487051,487041", // 1080p,720p,360|540p,360|480p,360p
      statusEqual: 2, // Ready
      orderBy: "-size",
    };
    return await getListedAssets(session, filter, pageIndex);
  };
  const getCaptionIds = async (session, entryIds, pageIndex) => {
    const filter = {
      objectType: "KalturaCaptionAssetFilter",
      entryIdIn: entryIds.join(),
      status: 2,
    };
    return await getListedAssets(session, filter, pageIndex);
  };
  const getVideoDownloadUrl = async (session, flavorId) => {
    return await getDownloadUrl(session, "VideoDownloadUrl", flavorId);
  };
  const getCaptionDownloadUrl = async (session, captionId) => {
    return await getDownloadUrl(session, "CaptionDownloadUrl", captionId);
  };
  const getSession = async () => {
    const session = await fetch(`${origin}/api/v1/player/kaltura_session/`);
    if (session.status === 200) {
      const sessionData = await session.json();
      sessionData.timestamp = new Date().getTime();
      return sessionData;
    } else {
      throw new Error("Could not get a valid session from O'Reilly Learning");
    }
  };
  const getConfig = async () => {
    const config = await fetch(`${origin}/api/v1/player/kaltura_config/`);
    return await config.json();
  };
  const mod = {
    getConfig,
    getSession,
    getMediaIds,
    getFlavorIds,
    getCaptionIds,
    getVideoDownloadUrl,
    getCaptionDownloadUrl,
  };
  return (window.mod = mod);
})();
