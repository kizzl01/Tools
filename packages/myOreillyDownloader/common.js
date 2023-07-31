"use strict";
// console.log("common.js start");
(() => {
  // console.log("first function in common.js");
  const formatFileSize = (bytes, decimalPoint) => {
    if (bytes == 0) return "0 Bytes";
    var k = 1000,
      dm = decimalPoint || 2,
      sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"],
      i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };
  const padZeroes = (input, number = 2) => {
    return input.toString().padStart(number, "0");
  };
  const formatDate = (date) => {
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  };
  const formatDateTimestamp = (date) => {
    const thisDate = new Date(date);
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: false,
    }).format(thisDate);
  };
  const replaceInvalidFileNameCharacters = (text) => {
    if (text && typeof text === "string") {
      if (text.startsWith(".")) text = text.substring(1);
      if (text.endsWith(".")) text = text.substring(0, text.length - 1);
      if (text.startsWith(String.fromCodePoint(160))) text = text.substring(1);
      return text.replace(/[:\/?"|*#<>%\\]/gi, "").replace(/\t/gi, " ");
    }
  };
  const objectToStringify = (object) => {
    var cache = [];
    const result = JSON.stringify(object, (key, value) => {
      if (typeof value === "object" && value !== null) {
        // Duplicate reference found, discard key
        if (cache.includes(value)) return;

        // Store value in our collection
        cache.push(value);
      }
      return value;
    });
    cache = null; // Enable garbage collection
    return result;
  };
  const createPopulatedElement = (
    tag,
    content,
    classes,
    event,
    eventCallback,
  ) => {
    const element = document.createElement(tag);

    if (content) {
      switch (typeof content) {
        case "string":
        case "number":
          element.innerText = content;
          break;
        case "object":
        case "function":
          element.appendChild(content);
          break;
      }
    }
    if (classes) {
      element.classList = classes;
    }
    if (event && eventCallback) {
      element.addEventListener(event, eventCallback);
    }
    return element;
  };
  const sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };
  const htmlEncode = (input) => {
    return input.replaceAll("&", "&amp;");
  };
  return (
    (window.formatDate = formatDate),
    (window.formatFileSize = formatFileSize),
    (window.formatDateTimestamp = formatDateTimestamp),
    (window.replaceInvalidFileNameCharacters =
      replaceInvalidFileNameCharacters),
    (window.createPopulatedElement = createPopulatedElement),
    (window.sleep = sleep),
    (window.padZeroes = padZeroes),
    (window.htmlEncode = htmlEncode)
  );
})();
