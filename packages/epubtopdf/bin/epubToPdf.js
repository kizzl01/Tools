#!/usr/bin/env node
var args = process.argv.splice(process.execArgv.length + 2);

var file;
// Retrieve the first argument
if (args.length > 0) file = args[0];

const myLibrary = require("../lib/index.js");

myLibrary.epubToPdf(file);
